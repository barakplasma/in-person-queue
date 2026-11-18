package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// The events stream carries the admin password as ?token=; it must reach the
// handler but never appear in a span.
func TestInstrumentHidesQueryFromSpansOnly(t *testing.T) {
	exp := tracetest.NewInMemoryExporter()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exp))
	old := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() { otel.SetTracerProvider(old) })

	mux := http.NewServeMux()
	var seen string
	mux.HandleFunc("GET /api/queues/{loc}/events", func(w http.ResponseWriter, r *http.Request) { seen = r.URL.Query().Get("token") })
	mux.HandleFunc("GET /healthz", func(http.ResponseWriter, *http.Request) {})
	h := instrument(mux, mux)

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/api/queues/cafe/events?token=s3cret", nil))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/healthz", nil))

	if seen != "s3cret" {
		t.Fatalf("handler lost the query: token = %q", seen)
	}
	spans := exp.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("want 1 span (healthz untraced), got %d", len(spans))
	}
	if got := spans[0].Name; got != "GET /api/queues/{loc}/events" {
		t.Errorf("span name = %q, want the route pattern", got)
	}
	for _, a := range spans[0].Attributes {
		if strings.Contains(a.Value.Emit(), "s3cret") || a.Key == "url.query" {
			t.Errorf("span leaks the query: %s=%s", a.Key, a.Value.Emit())
		}
	}
}
