import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

// Métricas del gateway para Prometheus. Usa los mismos nombres y etiquetas que los 9 microservicios
// (http_requests_total / http_request_duration_seconds con method, route, status) para que el
// dashboard de Grafana existente lo muestre sin cambios, y agrega métricas propias del gateway.
export function createMetrics(serviceName = "api-gateway") {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });
  collectDefaultMetrics({ register: registry, prefix: "educonecta_" });

  const httpRequests = new Counter({
    name: "http_requests_total",
    help: "Total de peticiones HTTP",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  });
  const httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "Duración de las peticiones HTTP en segundos",
    labelNames: ["method", "route", "status"],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry],
  });
  const upstreamFailures = new Counter({
    name: "gateway_upstream_failures_total",
    help: "Fallos al contactar un microservicio (error de red, timeout o 502/503/504)",
    labelNames: ["upstream"],
    registers: [registry],
  });
  const circuitState = new Gauge({
    name: "gateway_circuit_state",
    help: "Estado del circuit breaker por servicio: 0 cerrado, 1 semiabierto, 2 abierto",
    labelNames: ["upstream"],
    registers: [registry],
  });
  return { registry, httpRequests, httpDuration, upstreamFailures, circuitState };
}
