import { createApp } from "./app";
import { loadUpstreams } from "./routes";

const port = Number(process.env.PORT || 3000);
const app = createApp({
  upstreams: loadUpstreams(),
  proxyTimeoutMs: Number(process.env.PROXY_TIMEOUT_MS || 90000),
  breakerFailureThreshold: Number(process.env.BREAKER_FAILURE_THRESHOLD || 5),
  breakerCooldownMs: Number(process.env.BREAKER_COOLDOWN_SECONDS || 20) * 1000,
  corsOrigins: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
});
const server = app.listen(port, () => console.log(`[api-gateway] listening on port ${port}`));
server.requestTimeout = 0; // el plazo lo controla proxyTimeout (arranque en frío de Render)
server.headersTimeout = 95000;
