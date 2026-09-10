package internal

import (
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// upgrader апгрейдит входящее HTTP-соединение от браузера в WebSocket.
// CORS уже проверяется на уровне backend/фронтенда — здесь просто
// пропускаем любой Origin, т.к. сам гейтвей не хранит никакой
// чувствительной сессии, только проксирует байты.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// pongWait — если от одной из сторон нет ни одного входящего сообщения
// (в т.ч. pong-ответа) дольше этого срока, соединение считается мёртвым и
// закрывается. Без этого зависшая мобильная сеть/оборванный NAT-туннель
// оставлял бы горутины висеть на ReadMessage навсегда (нет TCP RST при
// таком разрыве).
const (
	pongWait   = 60 * time.Second
	pingPeriod = 30 * time.Second
	// writeWait — максимум, сколько один WriteMessage/WriteControl может
	// блокировать вызывающую горутину. Без явного дедлайна gorilla/websocket
	// ждёт запись НЕОГРАНИЧЕННО долго при подвисшей отправке (медленный
	// клиент, TCP-буфер полон).
	writeWait = 5 * time.Second
)

// BackendWSURL — адрес внутреннего WS-эндпоинта Python (backend),
// например ws://backend:8000/internal/ws/game
var BackendWSURL string

// wsConn оборачивает *websocket.Conn мьютексом на запись — gorilla/websocket
// не потокобезопасен для конкурентных Write* с разных горутин, а нам нужно
// писать в одно и то же соединение и из writer-лупа (см. ниже), и из
// pingLoop (keepalive) одновременно.
type wsConn struct {
	*websocket.Conn
	writeMu sync.Mutex
}

func (c *wsConn) writeMessage(msgType int, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
	return c.Conn.WriteMessage(msgType, data)
}

func (c *wsConn) writePing() error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.Conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait))
}

// latestMsg — буфер ровно на одно (последнее) сообщение с сигналом "есть
// новые данные". Используется для направления upstream->client: если запись
// клиенту физически медленная (плохая сеть конкретно у него), reader-горутина
// НЕ ждёт, пока writer освободится — она просто перезаписывает буфер новым
// тиком и продолжает читать следующий от Python. writer забирает из буфера
// только САМЫЙ СВЕЖИЙ тик, когда сам освобождается — устаревшие тики,
// которые клиент всё равно не успел бы отрисовать вовремя, просто дропаются
// вместо накопления в очереди. Раньше pipe() был одним синхронным циклом
// read->write: медленная запись этому клиенту напрямую откладывала чтение
// СЛЕДУЮЩЕГО тика для него же, что и давало наблюдаемые скачки интервала
// между тиками (сервер стабильно отдаёт ~33мс, а клиент с плохой сетью видел
// p95 до 130+мс) — не баг, а физика TCP-записи, но с dropping-буфером
// клиент видит реже обновлений на плохой сети, зато без НАКОПЛЕНИЯ задержки.
type latestMsg struct {
	mu       sync.Mutex
	cond     *sync.Cond
	msgType  int
	data     []byte
	hasData  bool
	closed   bool
}

func newLatestMsg() *latestMsg {
	m := &latestMsg{}
	m.cond = sync.NewCond(&m.mu)
	return m
}

func (m *latestMsg) Set(msgType int, data []byte) {
	m.mu.Lock()
	m.msgType = msgType
	m.data = data
	m.hasData = true
	m.mu.Unlock()
	m.cond.Signal()
}

// Wait блокируется, пока не появится новое сообщение или буфер не закрыт.
// Возвращает ok=false, если закрыт и данных больше не будет.
func (m *latestMsg) Wait() (msgType int, data []byte, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for !m.hasData && !m.closed {
		m.cond.Wait()
	}
	if m.closed && !m.hasData {
		return 0, nil, false
	}
	msgType, data = m.msgType, m.data
	m.hasData = false
	return msgType, data, true
}

func (m *latestMsg) Close() {
	m.mu.Lock()
	m.closed = true
	m.mu.Unlock()
	m.cond.Broadcast()
}

// GameHandler принимает клиента на /ws/game, поднимает parallel-соединение
// к Python с теми же query-параметрами и проксирует сообщения в обе
// стороны без изменения содержимого/типа фрейма (текст/бинарь сохраняются
// как есть).
func GameHandler(w http.ResponseWriter, r *http.Request) {
	rawClientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade error: %v", err)
		return
	}
	defer rawClientConn.Close()

	upstreamURL, err := buildUpstreamURL(r.URL.RawQuery)
	if err != nil {
		log.Printf("bad upstream url: %v", err)
		return
	}

	rawUpstreamConn, _, err := websocket.DefaultDialer.Dial(upstreamURL, nil)
	if err != nil {
		log.Printf("upstream dial error: %v", err)
		_ = rawClientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "upstream unavailable"))
		return
	}
	defer rawUpstreamConn.Close()

	clientConn := &wsConn{Conn: rawClientConn}
	upstreamConn := &wsConn{Conn: rawUpstreamConn}

	configureKeepalive(clientConn)
	configureKeepalive(upstreamConn)

	var once sync.Once
	closeBoth := func() {
		_ = rawClientConn.Close()
		_ = rawUpstreamConn.Close()
	}

	toClientBuf := newLatestMsg()

	var wg sync.WaitGroup
	wg.Add(5)

	// client -> upstream: input/aim/shoot/chat/... от браузера. Синхронный
	// read->write как раньше — это редкие events (не 30/сек тики), и каждый
	// важен (нельзя дропнуть чей-то выстрел), задержка на запись сюда не
	// вызывала наблюдаемую проблему.
	go func() {
		defer wg.Done()
		defer once.Do(closeBoth)
		pipeSync(clientConn, upstreamConn)
	}()
	go func() {
		defer wg.Done()
		defer once.Do(closeBoth)
		pingLoop(clientConn)
	}()

	// upstream -> client: reader кладёт каждый тик в dropping-буфер и сразу
	// читает следующий, не дожидаясь отправки клиенту; writer в отдельной
	// горутине забирает самый свежий тик и пишет его, когда освобождается.
	go func() {
		defer wg.Done()
		defer once.Do(closeBoth)
		defer toClientBuf.Close()
		pipeReaderToBuffer(upstreamConn, toClientBuf)
	}()
	go func() {
		defer wg.Done()
		defer once.Do(closeBoth)
		bufferWriterToClient(toClientBuf, clientConn)
	}()
	go func() {
		defer wg.Done()
		defer once.Do(closeBoth)
		pingLoop(upstreamConn)
	}()

	wg.Wait()
}

// configureKeepalive взводит дедлайн на чтение и продлевает его при каждом
// pong — без этого мёртвое соединение (разрыв без TCP RST, например у
// мобильного клиента) держало бы горутину на ReadMessage бесконечно.
func configureKeepalive(conn *wsConn) {
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
}

// pingLoop шлёт ping раз в pingPeriod, пока соединение живо; выход из
// цикла (по ошибке записи — соединение уже закрыто другой горутиной или
// разорвано) не требует отдельной обработки, только освобождение горутины.
func pingLoop(conn *wsConn) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for range ticker.C {
		if err := conn.writePing(); err != nil {
			return
		}
	}
}

// pipeSync — синхронный read->write, один цикл на направление. Используется
// только для client->upstream (input события), где важен каждый месседж и
// объём трафика низкий (не 30/сек), так что задержка на запись здесь не
// создаёт наблюдаемую проблему.
func pipeSync(src, dst *wsConn) {
	for {
		msgType, data, err := src.ReadMessage()
		if err != nil {
			return
		}
		_ = src.SetReadDeadline(time.Now().Add(pongWait))
		if err := dst.writeMessage(msgType, data); err != nil {
			return
		}
	}
}

// pipeReaderToBuffer читает от Python (30 тиков/сек) и кладёт каждый в
// dropping-буфер — НЕ ждёт, пока writer освободится, поэтому медленная сеть
// до конкретного клиента не задерживает чтение следующего тика.
func pipeReaderToBuffer(src *wsConn, buf *latestMsg) {
	for {
		msgType, data, err := src.ReadMessage()
		if err != nil {
			return
		}
		_ = src.SetReadDeadline(time.Now().Add(pongWait))
		buf.Set(msgType, data)
	}
}

// bufferWriterToClient забирает самый свежий тик из буфера и пишет клиенту;
// если запись подвисла (плохая сеть), к моменту её завершения в буфере уже
// может лежать более новый тик — предыдущие промежуточные дропаются, а не
// накапливаются в очереди.
func bufferWriterToClient(buf *latestMsg, dst *wsConn) {
	for {
		msgType, data, ok := buf.Wait()
		if !ok {
			return
		}
		if err := dst.writeMessage(msgType, data); err != nil {
			return
		}
	}
}

func buildUpstreamURL(rawQuery string) (string, error) {
	u, err := url.Parse(BackendWSURL)
	if err != nil {
		return "", err
	}
	u.RawQuery = rawQuery
	return u.String(), nil
}
