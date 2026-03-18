package main

import (
	"context"
	"log"
	"net/http"

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

	telemetry := newTelemetryService(config)
	store, err := newControllerStore(config)
	if err != nil {
		log.Fatal(err)
	}
	stateStore, err := newRolloutStateStore(config)
	if err != nil {
		log.Fatal(err)
	}

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

	go telemetry.startBackgroundValidation(context.Background())
	if satellite != nil {
		go satellite.start(context.Background())
	}
	if satelliteTasks != nil {
		go satelliteTasks.start(context.Background())
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", health)
	mux.HandleFunc("/telemetry/validate", withBearerAuth(config.ControllerBearerToken, telemetry.handleValidate))
	mux.HandleFunc("/telemetry/snapshot", withBearerAuth(config.ControllerBearerToken, telemetry.handleSnapshot))
	mux.HandleFunc("/rollouts/evaluate", withBearerAuth(config.ControllerBearerToken, decisionEngine.handleEvaluate))
	mux.HandleFunc("/rollouts/reconcile", withBearerAuth(config.ControllerBearerToken, reconciler.handleReconcile))
	mux.Handle("/metrics", promhttp.Handler())

	log.Printf("controller up on %s", config.HTTPPort)
	if err := http.ListenAndServe(config.HTTPPort, mux); err != nil {
		log.Fatal(err)
	}
}
