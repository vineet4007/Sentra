package main

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

func withBearerAuth(requiredToken string, next http.HandlerFunc) http.HandlerFunc {
	token := strings.TrimSpace(requiredToken)
	if token == "" {
		return next
	}

	return func(w http.ResponseWriter, r *http.Request) {
		authorization := strings.TrimSpace(r.Header.Get("Authorization"))
		if len(authorization) < len("Bearer ")+1 || !strings.EqualFold(authorization[:len("Bearer ")], "Bearer ") {
			writeUnauthorized(w)
			return
		}

		provided := strings.TrimSpace(authorization[len("Bearer "):])
		if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
			writeUnauthorized(w)
			return
		}

		next(w, r)
	}
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", `Bearer realm="sentra-controller"`)
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"ok":false,"error":{"message":"Unauthorized"}}`))
}
