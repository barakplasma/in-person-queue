// Command in-person-queue serves location-based real-time queues: one binary,
// no database. State lives in memory and is snapshotted to STATE_FILE.
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

	// unset: ./state.json; set to "": memory only
	stateFile, ok := os.LookupEnv("STATE_FILE")
	if !ok {
		stateFile = "state.json"
	}
	store := NewStore()
	if stateFile != "" {
		if err := store.Load(stateFile); err != nil {
			slog.Error("loading state", "file", stateFile, "error", err)
			os.Exit(1)
		}
	}

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
		save, sweep := time.NewTicker(time.Second), time.NewTicker(time.Minute)
		for {
			select {
			case <-save.C:
				if stateFile != "" {
					if err := store.Save(stateFile); err != nil {
						slog.Error("saving state", "error", err)
					}
				}
			case <-sweep.C:
				store.Sweep()
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

	slog.Info("listening", "port", port, "stateFile", stateFile)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
	<-shutdownDone // only save once no request can change state any more
	if stateFile != "" {
		if err := store.Save(stateFile); err != nil {
			slog.Error("saving state", "error", err)
			os.Exit(1)
		}
	}
}
