package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// otelEnabled is true when any OTLP endpoint is configured; without one the
// service runs exactly as before (no exporters, no background goroutines).
func otelEnabled() bool {
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "OTEL_EXPORTER_OTLP_") && strings.Contains(kv, "ENDPOINT=") {
			return true
		}
	}
	return false
}

// setupTelemetry sends traces, metrics and logs over OTLP/HTTP, configured by
// the standard OTEL_* env vars, and returns a shutdown that flushes all three.
// slog keeps writing to stderr and is also exported as OTLP log records.
func setupTelemetry(ctx context.Context) (func(context.Context) error, error) {
	if !otelEnabled() {
		return func(context.Context) error { return nil }, nil
	}
	res, err := resource.New(ctx, resource.WithFromEnv(), resource.WithTelemetrySDK(), resource.WithProcess())
	if err != nil {
		return nil, err
	}
	te, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(te), sdktrace.WithResource(res))
	me, err := otlpmetrichttp.New(ctx)
	if err != nil {
		return nil, err
	}
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewPeriodicReader(me)), sdkmetric.WithResource(res))
	le, err := otlploghttp.New(ctx)
	if err != nil {
		return nil, err
	}
	lp := sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewBatchProcessor(le)), sdklog.WithResource(res))

	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	global.SetLoggerProvider(lp)
	slog.SetDefault(slog.New(slog.NewMultiHandler(
		// Not slog.Default().Handler(): SetDefault points package log at the new
		// handler, and the default handler writes through package log, so it would loop.
		slog.NewTextHandler(os.Stderr, nil),
		otelslog.NewHandler("in-person-queue", otelslog.WithLoggerProvider(lp)),
	)))
	return func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx), lp.Shutdown(ctx))
	}, nil
}

type rawQueryKey struct{}

// instrument adds a server span and http.server.* metrics per request.
//   - Span names use the route pattern (GET /api/queues/{loc}/users), not the
//     URL, so queue names never become span names or metric labels.
//   - The query string is hidden from OTel: the events stream carries the admin
//     password as ?token=, and otelhttp would record it as url.query.
//   - /healthz probes are not traced.
func instrument(mux *http.ServeMux, next http.Handler) http.Handler {
	restore := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if q, ok := r.Context().Value(rawQueryKey{}).(string); ok {
			r.URL.RawQuery = q
		}
		next.ServeHTTP(w, r)
	})
	traced := otelhttp.NewHandler(restore, "in-person-queue",
		otelhttp.WithFilter(func(r *http.Request) bool { return r.URL.Path != "/healthz" }),
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			if _, pattern := mux.Handler(r); pattern != "" {
				return pattern
			}
			return r.Method + " (unrouted)"
		}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), rawQueryKey{}, r.URL.RawQuery)
		r2 := r.WithContext(ctx)
		r2.URL = &(*r.URL) // own copy: restore() writes RawQuery back
		r2.URL.RawQuery = ""
		traced.ServeHTTP(w, r2)
	})
}
