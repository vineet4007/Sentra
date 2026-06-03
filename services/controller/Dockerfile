FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod .
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/controller

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/controller /app/controller
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD port="${CONTROLLER_HTTP_PORT:-8090}"; port="${port#:}"; wget -qO- "http://127.0.0.1:${port}/health" >/dev/null || exit 1
ENTRYPOINT ["/app/controller"]
