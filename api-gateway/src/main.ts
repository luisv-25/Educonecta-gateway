import { createApp } from "./app";
import { loadUpstreams } from "./routes";

const port = Number(process.env.PORT || 3000);
const app = createApp({
  upstreams: loadUpstreams(),
  proxyTimeoutMs: Number(process.env.PROXY_TIMEOUT_MS || 90000),
  breakerFailureThreshold: Number(process.env.BREAKER_FAILURE_THRESHOLD || 5),
  breakerCooldownMs: Number(process.env.BREAKER_COOLDOWN_SECONDS || 20) * 1000,
  jwtSecret: process.env.JWT_SECRET || undefined,
  rateLimit: {
    auth: Number(process.env.RATE_LIMIT_AUTH_PER_MIN || 30),
    catalog: Number(process.env.RATE_LIMIT_CATALOG_PER_MIN || 300),
    general: Number(process.env.RATE_LIMIT_GENERAL_PER_MIN || 600),
  },
  corsOrigins: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
});
if (!process.env.JWT_SECRET) console.warn("[api-gateway] JWT_SECRET no definido: el gateway NO valida tokens (solo enruta). Defínelo igual que en los microservicios.");
const server = app.listen(port, () => console.log(`[api-gateway] listening on port ${port}`));
server.requestTimeout = 0; // el plazo lo controla proxyTimeout (arranque en frío de Render)
server.headersTimeout = 95000;
