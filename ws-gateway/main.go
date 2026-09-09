// ws-gateway — лёгкий Go-сервис, принимающий WebSocket-соединения игроков
// и проксирующий их к игровому серверу на Python (backend). Вся игровая
// логика и тик-цикл остаются в Python; Go снимает с его event loop
// нагрузку по обслуживанию N конкурентных клиентских сокетов на "последней
// миле" (реальные клиенты, разный RTT), что Go делает эффективнее за счёт
// лёгких горутин на соединение.
package main

import (
	"log"
	"net/http"
	"os"

	"ws-gateway/internal"
)

func main() {
	backendWSURL := os.Getenv("BACKEND_WS_URL")
	if backendWSURL == "" {
		backendWSURL = "ws://backend:8000/internal/ws/game"
	}
	internal.BackendWSURL = backendWSURL

	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8000"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/game", internal.GameHandler)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	log.Printf("ws-gateway listening on %s, upstream=%s", addr, backendWSURL)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
