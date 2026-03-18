package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWithBearerAuthAllowsRequestsWhenTokenDisabled(t *testing.T) {
	handler := withBearerAuth("", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/rollouts/reconcile", nil)
	recorder := httptest.NewRecorder()
	handler(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected unauthenticated request to pass when token disabled, got %d", recorder.Code)
	}
}

func TestWithBearerAuthRejectsMissingHeader(t *testing.T) {
	handler := withBearerAuth("top-secret", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodPost, "/rollouts/reconcile", nil)
	recorder := httptest.NewRecorder()
	handler(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing auth header, got %d", recorder.Code)
	}
}

func TestWithBearerAuthRejectsBadToken(t *testing.T) {
	handler := withBearerAuth("top-secret", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodPost, "/rollouts/reconcile", nil)
	request.Header.Set("Authorization", "Bearer wrong-token")
	recorder := httptest.NewRecorder()
	handler(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid token, got %d", recorder.Code)
	}
}

func TestWithBearerAuthAllowsGoodToken(t *testing.T) {
	handler := withBearerAuth("top-secret", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	})

	request := httptest.NewRequest(http.MethodPost, "/rollouts/reconcile", nil)
	request.Header.Set("Authorization", "Bearer top-secret")
	recorder := httptest.NewRecorder()
	handler(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected request with valid token to pass, got %d", recorder.Code)
	}
}
