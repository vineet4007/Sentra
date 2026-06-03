package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	ready = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "sentra_controller_ready",
		Help: "Readiness of the controller (1=ready)",
	})
)

func health(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func main() {
	config, err := loadControllerConfig()
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	telemetry := newTelemetryService(config)
	store, err := newControllerStore(config)
	if err != nil {
		log.Fatal(err)
	}
	defer store.db.Close()
	stateStore, err := newRolloutStateStore(config)
	if err != nil {
		log.Fatal(err)
	}
	defer stateStore.client.Close()

	decisionEngine := newDecisionEngine(telemetry, stateStore)
	reconciler := newRolloutReconciler(config, store, stateStore, decisionEngine)
	satellite := newSatelliteCoordinator(config, telemetry)
	satelliteTasks := newSatelliteTaskWorker(config, reconciler)
	prometheus.MustRegister(
		ready,
		telemetrySourceUp,
		telemetrySourceLatency,
		telemetryLastValidation,
		rolloutEvaluationsTotal,
		rolloutDecisionsTotal,
		rolloutGateFailuresTotal,
		satelliteHeartbeatsTotal,
		satelliteLastSuccess,
		satelliteTasksTotal,
		satelliteTaskLastSuccess,
	)
	ready.Set(1)

	go telemetry.startBackgroundValidation(ctx)
	if satellite != nil {
		go satellite.start(ctx)
	}
	if satelliteTasks != nil {
		go satelliteTasks.start(ctx)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", health)
	mux.HandleFunc("/telemetry/validate", withBearerAuth(config.ControllerBearerToken, telemetry.handleValidate))
	mux.HandleFunc("/telemetry/snapshot", withBearerAuth(config.ControllerBearerToken, telemetry.handleSnapshot))
	mux.HandleFunc("/rollouts/evaluate", withBearerAuth(config.ControllerBearerToken, decisionEngine.handleEvaluate))
	mux.HandleFunc("/rollouts/reconcile", withBearerAuth(config.ControllerBearerToken, reconciler.handleReconcile))
	mux.Handle("/metrics", promhttp.Handler())

	server := &http.Server{
		Addr:              config.HTTPPort,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		ready.Set(0)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		log.Printf("controller shutting down")
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("controller graceful shutdown failed: %v", err)
			_ = server.Close()
		}
	}()

	log.Printf("controller up on %s", config.HTTPPort)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
