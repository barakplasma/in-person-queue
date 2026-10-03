// Command in-person-queue serves location-based real-time queues: one binary,
// with an embedded database (Redka on SQLite) in DB_FILE.
package main

import (
	"cmp"
	"context"
	"embed"
	"errors"
	"flag"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

//go:embed client
var clientFS embed.FS

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe /healthz on $PORT and exit 0 if healthy (for Docker HEALTHCHECK)")
	flag.Parse()
	port := cmp.Or(os.Getenv("PORT"), "8080")
	if *healthcheck {
		resp, err := http.Get("http://127.0.0.1:" + port + "/healthz")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	// unset: ./queues.db; set to "": memory only
	dbFile, ok := os.LookupEnv("DB_FILE")
	if !ok {
		dbFile = "queues.db"
	}
	path := cmp.Or(dbFile, "file:/in-person-queue.db?vfs=memdb")
	store, err := OpenStore(path)
	if err != nil {
		slog.Error("opening database", "path", path, "error", err)
		os.Exit(1)
	}
	defer store.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	static, _ := fs.Sub(clientFS, "client")
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           newHandler(store, static),
		ReadHeaderTimeout: 10 * time.Second,
		// cancelled on shutdown, which ends the long-lived event streams so browsers reconnect elsewhere
		BaseContext: func(net.Listener) context.Context { return ctx },
	}

	go func() {
		ticker := time.NewTicker(10 * time.Second)
		for {
			select {
			case <-ticker.C:
				if err := store.Sweep(); err != nil {
					slog.Error("sweeping expired queues", "error", err)
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		slog.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx) // waits for in-flight requests
	}()

	slog.Info("listening", "port", port, "db", path)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
	<-shutdownDone // close the database only once no request can use it any more
}
