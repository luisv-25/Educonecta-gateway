import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { createProxyMiddleware } from "http-proxy-middleware";
import { isPublicRoute, verifyJwt } from "./auth";
import { CircuitBreaker } from "./circuit-breaker";
import { RateLimiter, tierFor } from "./rate-limit";
import { createMetrics } from "./metrics";
import { resolveService, SERVICE_ROUTES, ServiceName } from "./routes";

export interface GatewayOptions {
  upstreams: Record<ServiceName, string>;
  proxyTimeoutMs?: number;
  breakerFailureThreshold?: number;
  breakerCooldownMs?: number;
  corsOrigins?: string[];
  /** Secreto JWT (el mismo de los microservicios). Sin él, el gateway NO valida tokens (modo permisivo). */
  jwtSecret?: string;
  /** Peticiones por minuto y por IP (auth / catálogo público / general). */
  rateLimit?: { auth: number; catalog: number; general: number };
}

const STATE_VALUE = { closed: 0, half_open: 1, open: 2 } as const;

export function createApp(opts: GatewayOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // detrás del balanceador de Render: la IP real viene en X-Forwarded-For
  const limiter = new RateLimiter({ auth: 30, catalog: 300, general: 600, ...opts.rateLimit, windowMs: 60000 });
  const metrics = createMetrics();
  const breakers = {} as Record<ServiceName, CircuitBreaker>;
  for (const r of SERVICE_ROUTES) {
    breakers[r.name] = new CircuitBreaker(opts.breakerFailureThreshold ?? 5, opts.breakerCooldownMs ?? 20000);
    metrics.circuitState.set({ upstream: r.name }, 0);
  }
  const syncState = (s: ServiceName) => metrics.circuitState.set({ upstream: s }, STATE_VALUE[breakers[s].getState()]);
  const fail = (s: ServiceName) => {
    breakers[s].recordFailure();
    metrics.upstreamFailures.inc({ upstream: s });
    syncState(s);
  };

  // 1) Correlation id: se reutiliza el del cliente o se crea uno, viaja a los microservicios y vuelve en la respuesta.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers["x-correlation-id"] as string) || randomUUID();
    req.headers["x-correlation-id"] = id;
    res.setHeader("x-correlation-id", id);
    next();
  });

  // 2) Métricas y log de acceso (una línea JSON por petición, con el correlation id).
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/metrics") return next();
    const end = metrics.httpDuration.startTimer();
    const startedAt = Date.now();
    res.on("finish", () => {
      const match = resolveService(req.originalUrl);
      const route = match ? `/api/v1/${match.segment}` : req.path === "/health" || req.path === "/ready" ? req.path : "no_encontrada";
      const labels = { method: req.method, route, status: String(res.statusCode) };
      metrics.httpRequests.inc(labels);
      end(labels);
      if (process.env.NODE_ENV !== "test") {
        console.log(JSON.stringify({ svc: "api-gateway", cid: req.headers["x-correlation-id"], method: req.method, path: req.originalUrl.split("?")[0], upstream: match?.service ?? null, status: res.statusCode, ms: Date.now() - startedAt }));
      }
    });
    next();
  });

  // 3) CORS: lo resuelve SOLO el gateway (se quitan los encabezados CORS de los microservicios para no duplicarlos).
  app.use(cors({ origin: opts.corsOrigins && opts.corsOrigins.length ? opts.corsOrigins : true, exposedHeaders: ["x-correlation-id"] }));

  // 4) Endpoints propios del gateway.
  app.get("/health", (_req, res) => res.json({ status: "ok", service: "api-gateway", uptime: Math.round(process.uptime()) }));
  app.get("/ready", async (req, res) => {
    const circuits = Object.fromEntries(SERVICE_ROUTES.map((r) => [r.name, breakers[r.name].getState()]));
    if (req.query.deep !== "true") return res.json({ status: "ready", mode: "shallow", jwtValidation: opts.jwtSecret ? "enabled" : "disabled", circuits });
    // Revisión profunda: consulta /health de cada servicio (despierta los dormidos; úsese con moderación).
    const checks = await Promise.all(
      SERVICE_ROUTES.map(async (r) => {
        try {
          const resp = await fetch(`${opts.upstreams[r.name]}/health`, { signal: AbortSignal.timeout(5000) });
          return [r.name, resp.status < 500 ? "up" : "down"] as const;
        } catch {
          return [r.name, "down"] as const;
        }
      }),
    );
    const services = Object.fromEntries(checks);
    const allUp = checks.every(([, s]) => s === "up");
    res.status(allUp ? 200 : 503).json({ status: allUp ? "ready" : "degraded", mode: "deep", services, circuits });
  });
  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  });

  // 5) Resolución de ruta, límite de peticiones y validación de JWT.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!resolveService(req.originalUrl)) return next(); // se responde 404 en el siguiente paso
    const rl = limiter.hit(req.ip || "desconocida", tierFor(req.method, req.originalUrl));
    res.setHeader("X-RateLimit-Limit", rl.limit);
    res.setHeader("X-RateLimit-Remaining", rl.remaining);
    if (!rl.allowed) {
      res.setHeader("Retry-After", rl.retryAfterSeconds);
      return res.status(429).json({ statusCode: 429, error: "too_many_requests", message: `Demasiadas peticiones; reintente en ${rl.retryAfterSeconds} s.` });
    }
    if (opts.jwtSecret && !isPublicRoute(req.method, req.originalUrl)) {
      const header = req.headers.authorization || "";
      const payload = header.startsWith("Bearer ") ? verifyJwt(header.slice(7), opts.jwtSecret) : null;
      if (!payload) return res.status(401).json({ statusCode: 401, error: "unauthorized", message: "Token ausente, inválido o vencido." });
    }
    next();
  });

  // 6) Resolución de ruta + circuit breaker.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const match = resolveService(req.originalUrl);
    if (!match) {
      return res.status(404).json({ statusCode: 404, error: "route_not_found", message: `El gateway no tiene ruta para ${req.method} ${req.path}` });
    }
    (req as any).upstream = match.service;
    if (!breakers[match.service].allow()) {
      syncState(match.service);
      res.setHeader("Retry-After", Math.ceil((opts.breakerCooldownMs ?? 20000) / 1000));
      return res.status(503).json({ statusCode: 503, error: "circuit_open", service: match.service, message: `El servicio ${match.service} no responde; reintente en unos segundos.` });
    }
    syncState(match.service);
    next();
  });

  // 7) Proxy inverso en streaming (sin leer el cuerpo: cubre JSON grandes con PDF en base64 y multipart).
  app.use(
    createProxyMiddleware({
      target: opts.upstreams.user, // valor por defecto; el real lo decide router() según la ruta
      router: (req) => opts.upstreams[(req as any).upstream as ServiceName],
      changeOrigin: true,
      xfwd: true,
      proxyTimeout: opts.proxyTimeoutMs ?? 90000,
      timeout: opts.proxyTimeoutMs ?? 90000,
      on: {
        proxyRes: (proxyRes, req) => {
          const s = (req as any).upstream as ServiceName;
          for (const h of Object.keys(proxyRes.headers)) if (h.startsWith("access-control-")) delete proxyRes.headers[h];
          proxyRes.headers["x-served-by"] = `api-gateway/${s}`;
          const code = proxyRes.statusCode ?? 0;
          if (code === 502 || code === 503 || code === 504) fail(s);
          else {
            breakers[s].recordSuccess();
            syncState(s);
          }
        },
        error: (err: any, req, res) => {
          const s = (req as any).upstream as ServiceName;
          fail(s);
          if ("writeHead" in res && !res.headersSent) {
            const timeout = err?.code === "ETIMEDOUT" || err?.code === "ESOCKETTIMEDOUT";
            const status = timeout ? 504 : 502;
            res.writeHead(status, { "Content-Type": "application/json", "x-correlation-id": String(req.headers["x-correlation-id"]) });
            res.end(JSON.stringify({ statusCode: status, error: timeout ? "upstream_timeout" : "upstream_unreachable", service: s, message: `No se pudo contactar al servicio ${s}.` }));
          }
        },
      },
    }),
  );

  return app;
}
