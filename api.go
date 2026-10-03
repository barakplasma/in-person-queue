package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

func newHandler(s *Store, static fs.FS) http.Handler {
	mux := http.NewServeMux()
	files := http.FileServerFS(static)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r) // no directory listings
			return
		}
		files.ServeHTTP(w, r)
	})

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /api/queues", func(w http.ResponseWriter, r *http.Request) {
		lat, lon, _, err := parseLocation(r.URL.Query().Get("near"))
		if err != nil {
			writeError(w, err)
			return
		}
		nearby, err := s.Nearby(lat, lon)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, nearby)
	})

	mux.HandleFunc("POST /api/queues", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Location string }
		if err := readJSON(w, r, &body); err != nil {
			writeError(w, err)
			return
		}
		_, _, location, err := parseLocation(body.Location)
		if err == nil {
			var password string
			if password, err = s.Create(location); err == nil {
				slog.Info("created queue", "queue", location)
				writeJSON(w, http.StatusCreated, map[string]string{"location": location, "password": password})
				return
			}
		}
		writeError(w, err)
	})

	mux.HandleFunc("POST /api/queues/{loc}/users", func(w http.ResponseWriter, r *http.Request) {
		location, err := pathLocation(r)
		if err == nil {
			var id string
			if id, err = s.Join(location); err == nil {
				writeJSON(w, http.StatusCreated, map[string]string{"userId": id})
				return
			}
		}
		writeError(w, err)
	})

	mux.HandleFunc("DELETE /api/queues/{loc}/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		location, err := pathLocation(r)
		if err == nil {
			err = s.Leave(location, r.PathValue("id"))
		}
		writeResult(w, err)
	})

	// admin
	mux.HandleFunc("GET /api/queues/{loc}/admin", admin(s, func(w http.ResponseWriter, r *http.Request, location string) {
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /api/queues/{loc}/next", admin(s, func(w http.ResponseWriter, r *http.Request, location string) {
		writeResult(w, s.Next(location))
	}))
	mux.HandleFunc("PUT /api/queues/{loc}/message", admin(s, func(w http.ResponseWriter, r *http.Request, location string) {
		var body struct{ Message string }
		err := readJSON(w, r, &body)
		if err == nil {
			err = s.SetMessage(location, body.Message)
		}
		writeResult(w, err)
	}))

	mux.HandleFunc("GET /api/queues/{loc}/events", func(w http.ResponseWriter, r *http.Request) {
		location, err := pathLocation(r)
		if err != nil {
			writeError(w, err)
			return
		}
		// EventSource can't send headers, so the admin password comes as ?token= (over HTTPS)
		query := r.URL.Query()
		isAdmin := query.Has("token") && s.Authorized(location, query.Get("token"))
		if query.Has("token") && !isAdmin {
			writeError(w, errUnauthorized)
			return
		}
		streamEvents(w, r, s, location, query.Get("user"), isAdmin)
	})

	return securityHeaders(mux)
}

// streamEvents sends the queue's View now and after every change, until the client goes away.
func streamEvents(w http.ResponseWriter, r *http.Request, s *Store, location, user string, isAdmin bool) {
	changes, unsubscribe := s.Subscribe(location)
	defer unsubscribe()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no") // don't let nginx-style proxies buffer the stream
	rc := http.NewResponseController(w)
	keepalive := time.NewTicker(25 * time.Second) // proxies drop idle connections
	defer keepalive.Stop()
	for {
		view := s.View(location, user, isAdmin)
		data, _ := json.Marshal(view)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil || rc.Flush() != nil || view.Gone {
			return
		}
		for waiting := true; waiting; {
			select {
			case <-changes:
				waiting = false
			case <-keepalive.C:
				if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil || rc.Flush() != nil {
					return
				}
			case <-r.Context().Done():
				return
			}
		}
	}
}

var errUnauthorized = errors.New("not authorized for this queue")

// admin wraps a handler that requires the queue's password as a bearer token.
func admin(s *Store, next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		location, err := pathLocation(r)
		if err != nil {
			writeError(w, err)
			return
		}
		password, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !s.Authorized(location, password) {
			writeError(w, errUnauthorized)
			return
		}
		next(w, r, location)
	}
}

func pathLocation(r *http.Request) (string, error) {
	_, _, location, err := parseLocation(r.PathValue("loc"))
	return location, err
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(v); err != nil {
		return fmt.Errorf("%w: %v", errBadRequest, err)
	}
	return nil
}

var errBadRequest = errors.New("bad request")

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeResult(w http.ResponseWriter, err error) {
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, errInvalidLocation), errors.Is(err, errBadRequest):
		status = http.StatusBadRequest
	case errors.Is(err, errUnauthorized):
		status = http.StatusUnauthorized
	case errors.Is(err, errNotFound):
		status = http.StatusNotFound
	case errors.Is(err, errExists):
		status = http.StatusConflict
	case errors.Is(err, errFull), errors.Is(err, errTooManyQueues):
		status = http.StatusTooManyRequests
	}
	if status == http.StatusInternalServerError {
		slog.Error("request failed", "error", err)
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer") // admin URLs carry the password
		next.ServeHTTP(w, r)
	})
}
