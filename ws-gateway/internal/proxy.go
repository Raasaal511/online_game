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
)

// BackendWSURL — адрес внутреннего WS-эндпоинта Python (backend),
// например ws://backend:8000/internal/ws/game
var BackendWSURL string

// wsConn оборачивает *websocket.Conn мьютексом на запись — gorilla/websocket
// не потокобезопасен для конкурентных Write* с разных горутин, а нам нужно
// писать в одно и то же соединение и из pipe (проксируемые сообщения), и
// из pingLoop (keepalive) одновременно.
type wsConn struct {
	*websocket.Conn
	writeMu sync.Mutex
}

func (c *wsConn) writeMessage(msgType int, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.Conn.WriteMessage(msgType, data)
}

func (c *wsConn) writePing() error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.Conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second))
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

	var wg sync.WaitGroup
	wg.Add(4)

	// client -> upstream: input/aim/shoot/chat/... от браузера идут в Python как есть.
	go func() {
		defer wg.Done()
		defer once.Do(closeBoth)
		pipe(clientConn, upstreamConn)
	}()
	go func() {
		defer wg.Done()
		defer once.Do(closeBoth)
		pingLoop(clientConn)
	}()

	// upstream -> client: welcome/state/chat/death от Python идут в браузер как есть.
	go func() {
		defer wg.Done()
		defer once.Do(closeBoth)
		pipe(upstreamConn, clientConn)
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

func pipe(src, dst *wsConn) {
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

func buildUpstreamURL(rawQuery string) (string, error) {
	u, err := url.Parse(BackendWSURL)
	if err != nil {
		return "", err
	}
	u.RawQuery = rawQuery
	return u.String(), nil
}
