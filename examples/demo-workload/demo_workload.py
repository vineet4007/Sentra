from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import parse, request


BUCKETS = [0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 2.0, float("inf")]


class DemoState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.mode = "healthy"
        self.labels = {
            "project": os.environ.get("DEMO_PROJECT", "sentra-demo"),
            "service": os.environ.get("DEMO_SERVICE", "demo-workload"),
            "env": os.environ.get("DEMO_ENVIRONMENT", "staging"),
            "version": os.environ.get("DEMO_VERSION", "demo-candidate"),
        }
        self.counts: dict[tuple[str, str], float] = {}
        self.sums: dict[tuple[str, str], float] = {}
        self.buckets: dict[tuple[str, str, str], float] = {}

    def set_scenario(self, mode: str, labels: dict[str, str]) -> None:
        if mode not in {"healthy", "unhealthy"}:
            raise ValueError("mode must be healthy or unhealthy")
        with self.lock:
            self.mode = mode
            for key, value in labels.items():
                if value:
                    self.labels[key] = value
            self.counts.clear()
            self.sums.clear()
            self.buckets.clear()

    def tick(self) -> tuple[str, dict[str, str], int, int]:
        with self.lock:
            labels = dict(self.labels)
            mode = self.mode
            if mode == "unhealthy":
                self._observe("500", 1.2, 18)
                self._observe("200", 0.7, 7)
                return mode, labels, 25, 18
            self._observe("200", 0.08, 25)
            return mode, labels, 25, 0

    def _observe(self, status_code: str, latency_seconds: float, count: int) -> None:
        label_key = self._label_key()
        count_key = (label_key, status_code)
        self.counts[count_key] = self.counts.get(count_key, 0) + count
        self.sums[count_key] = self.sums.get(count_key, 0) + (latency_seconds * count)
        for bucket in BUCKETS:
            if latency_seconds <= bucket:
                bucket_label = "+Inf" if bucket == float("inf") else format(bucket, "g")
                bucket_key = (label_key, status_code, bucket_label)
                self.buckets[bucket_key] = self.buckets.get(bucket_key, 0) + count

    def render_metrics(self) -> str:
        with self.lock:
            lines = [
                "# HELP http_server_request_duration_seconds Demo workload HTTP request duration.",
                "# TYPE http_server_request_duration_seconds histogram",
            ]
            for (label_key, status_code, le), value in sorted(self.buckets.items()):
                labels = f"{label_key},status_code=\"{status_code}\",le=\"{le}\""
                lines.append(f"http_server_request_duration_seconds_bucket{{{labels}}} {value}")
            for (label_key, status_code), value in sorted(self.counts.items()):
                labels = f"{label_key},status_code=\"{status_code}\""
                lines.append(f"http_server_request_duration_seconds_count{{{labels}}} {value}")
                lines.append(f"http_server_request_duration_seconds_sum{{{labels}}} {self.sums.get((label_key, status_code), 0)}")
            current_label_key = self._label_key()
            for status_code in ("200", "500"):
                if (current_label_key, status_code) in self.counts:
                    continue
                labels = f"{current_label_key},status_code=\"{status_code}\""
                lines.append(f"http_server_request_duration_seconds_count{{{labels}}} 0")
                lines.append(f"http_server_request_duration_seconds_sum{{{labels}}} 0")
            return "\n".join(lines) + "\n"

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            return {
                "mode": self.mode,
                "labels": dict(self.labels),
                "series": len(self.counts),
            }

    def _label_key(self) -> str:
        return ",".join(f'{key}="{value}"' for key, value in sorted(self.labels.items()))


state = DemoState()


def push_loki(mode: str, labels: dict[str, str], total: int, errors: int) -> None:
    loki_url = os.environ.get("LOKI_URL", "http://loki:3100").rstrip("/")
    tenant_id = os.environ.get("LOKI_TENANT_ID", "local")
    now_ns = str(time.time_ns())
    level = "error" if errors > 0 else "info"
    message = f"level={level} mode={mode} total={total} failed={errors} service={labels['service']} version={labels['version']}"
    stream = {
        "job": "demo-workload",
        "project": labels["project"],
        "service": labels["service"],
        "env": labels["env"],
        "version": labels["version"],
    }
    payload = json.dumps({"streams": [{"stream": stream, "values": [[now_ns, message]]}]}).encode("utf-8")
    req = request.Request(
        f"{loki_url}/loki/api/v1/push",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Scope-OrgID": tenant_id,
        },
        method="POST",
    )
    try:
        request.urlopen(req, timeout=1).close()
    except Exception:
        pass


def background_loop() -> None:
    while True:
        mode, labels, total, errors = state.tick()
        push_loki(mode, labels, total, errors)
        time.sleep(1)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = parse.urlparse(self.path)
        if parsed.path == "/health":
            self.write_json({"status": "ok"})
            return
        if parsed.path == "/scenario":
            query = parse.parse_qs(parsed.query)
            mode = first(query, "mode", "healthy")
            labels = {
                "project": first(query, "project", ""),
                "service": first(query, "service", ""),
                "env": first(query, "environment", ""),
                "version": first(query, "version", ""),
            }
            try:
                state.set_scenario(mode, labels)
            except ValueError as error:
                self.write_json({"ok": False, "error": str(error)}, status=400)
                return
            self.write_json({"ok": True, "data": state.snapshot()})
            return
        if parsed.path == "/metrics":
            body = state.render_metrics().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.write_json({"ok": False, "error": "not found"}, status=404)

    def log_message(self, format: str, *args: object) -> None:
        return

    def write_json(self, payload: dict[str, object], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def first(query: dict[str, list[str]], key: str, fallback: str) -> str:
    values = query.get(key)
    if not values:
        return fallback
    return values[0]


def main() -> None:
    threading.Thread(target=background_loop, daemon=True).start()
    port = int(os.environ.get("PORT", "9102"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
