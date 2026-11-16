import http from "http";
import { AddressInfo } from "net";
import request from "supertest";
import { createApp } from "../../src/app";
import { loadUpstreams, ServiceName } from "../../src/routes";
import { firmar } from "../helpers/jwt";

// Microservicios simulados: devuelven lo que recibieron (método, ruta, cuerpo y encabezados) para
// comprobar qué reenvía el gateway. Incluyen su propio encabezado CORS para verificar que no se duplica.
function fakeService(name: string): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") return res.end("ok");
    if (req.url?.startsWith("/api/v1/fail")) { res.statusCode = 503; return res.end("caído"); }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "https://otro-origen.com");
      res.end(JSON.stringify({ service: name, method: req.method, url: req.url, body: Buffer.concat(chunks).toString(), auth: req.headers.authorization, cid: req.headers["x-correlation-id"] }));
    });
  });
  return new Promise((ok) => server.listen(0, () => ok(server)));
}
const urlOf = (s: http.Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

describe("Integración: API Gateway frente a microservicios simulados", () => {
  let servers: Record<string, http.Server>;
  let upstreams: Record<ServiceName, string>;
  const DEAD = "http://127.0.0.1:1"; // nadie escucha: simula un servicio caído

  beforeAll(async () => {
    servers = { user: await fakeService("user"), catalog: await fakeService("catalog"), payment: await fakeService("payment") };
    upstreams = { ...loadUpstreams({} as any), user: urlOf(servers.user), catalog: urlOf(servers.catalog), payment: urlOf(servers.payment), booking: DEAD };
  });
  afterAll(async () => { await Promise.all(Object.values(servers).map((s) => new Promise((ok) => s.close(ok)))); });

  it("enruta por prefijo, reenvía cuerpo y Authorization, maneja correlation-id y CORS, responde 404 a rutas desconocidas y abre el circuito de un servicio caído", async () => {
    const app = createApp({ upstreams, breakerFailureThreshold: 2, breakerCooldownMs: 60000, proxyTimeoutMs: 5000 });

    // Endpoints propios
    expect((await request(app).get("/health").expect(200)).body).toMatchObject({ status: "ok", service: "api-gateway" });
    expect((await request(app).get("/ready").expect(200)).body).toMatchObject({ status: "ready", mode: "shallow" });
    expect((await request(app).get("/metrics").expect(200)).text).toContain("gateway_circuit_state");

    // Enrutamiento: login va a user, subjects a catalog; la ruta COMPLETA llega intacta al servicio
    const login = await request(app).post("/api/v1/auth/login").set("Authorization", "Bearer abc").send({ email: "a@b.co", password: "x" }).expect(200);
    expect(login.body).toMatchObject({ service: "user", method: "POST", url: "/api/v1/auth/login", auth: "Bearer abc" });
    expect(JSON.parse(login.body.body)).toEqual({ email: "a@b.co", password: "x" });
    const subj = await request(app).get("/api/v1/subjects?limit=5").expect(200);
    expect(subj.body).toMatchObject({ service: "catalog", url: "/api/v1/subjects?limit=5" });
    expect(subj.headers["x-served-by"]).toBe("api-gateway/catalog");

    // Correlation id: se crea si no viene (y llega al servicio) y se respeta si viene
    expect(subj.headers["x-correlation-id"]).toBeTruthy();
    expect(subj.body.cid).toBe(subj.headers["x-correlation-id"]);
    const conId = await request(app).get("/api/v1/subjects").set("x-correlation-id", "cid-123").expect(200);
    expect(conId.headers["x-correlation-id"]).toBe("cid-123");
    expect(conId.body.cid).toBe("cid-123");

    // CORS lo decide el gateway: no pasa el encabezado del microservicio
    const cors = await request(app).get("/api/v1/subjects").set("Origin", "https://educonecta.vercel.app").expect(200);
    expect(cors.headers["access-control-allow-origin"]).toBe("https://educonecta.vercel.app");

    // Ruta sin servicio -> 404 del gateway
    expect((await request(app).get("/api/v1/nada").expect(404)).body.error).toBe("route_not_found");

    // Servicio caído (booking): 502 hasta llegar al umbral y luego 503 inmediato con circuito abierto
    expect((await request(app).get("/api/v1/bookings").expect(502)).body).toMatchObject({ error: "upstream_unreachable", service: "booking" });
    await request(app).get("/api/v1/bookings").expect(502);
    const abierto = await request(app).get("/api/v1/bookings").expect(503);
    expect(abierto.body).toMatchObject({ error: "circuit_open", service: "booking" });
    expect(abierto.headers["retry-after"]).toBe("60");
    // el resto de servicios sigue funcionando (el fallo está aislado)
    await request(app).get("/api/v1/transactions").expect(200);
    expect((await request(app).get("/metrics")).text).toMatch(/gateway_circuit_state\{upstream="booking"[^}]*\} 2/);
  });

  it("/ready?deep=true consulta /health de cada servicio y reporta degradado si alguno no responde", async () => {
    const app = createApp({ upstreams });
    const r = await request(app).get("/ready?deep=true").expect(503);
    expect(r.body).toMatchObject({ status: "degraded", mode: "deep" });
    expect(r.body.services.user).toBe("up");
    expect(r.body.services.booking).toBe("down");
  });

  it("con JWT_SECRET: rutas públicas pasan sin token, las protegidas exigen token válido (401 si falta o está vencido) y el login se limita a N intentos por minuto", async () => {
    const app = createApp({ upstreams, jwtSecret: "secreto", rateLimit: { auth: 3, catalog: 100, general: 100 } });
    expect((await request(app).get("/ready")).body.jwtValidation).toBe("enabled");

    await request(app).get("/api/v1/subjects").expect(200); // público: catálogo
    await request(app).get("/api/v1/transactions").expect(401); // protegida sin token
    await request(app).get("/api/v1/transactions").set("Authorization", "Bearer basura").expect(401);
    const vencido = firmar({ sub: "u1", role: "student", exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await request(app).get("/api/v1/transactions").set("Authorization", `Bearer ${vencido}`).expect(401)).body.error).toBe("unauthorized");
    const valido = firmar({ sub: "u1", role: "student", exp: Math.floor(Date.now() / 1000) + 600 });
    const ok = await request(app).get("/api/v1/transactions").set("Authorization", `Bearer ${valido}`).expect(200);
    expect(ok.body).toMatchObject({ service: "payment", auth: `Bearer ${valido}` }); // el token llega al servicio

    // Límite en login: 3 por minuto por IP; la 4.ª recibe 429 con Retry-After y no llega al servicio
    for (let i = 0; i < 3; i++) await request(app).post("/api/v1/auth/login").send({ email: "a@b.co", password: "x" }).expect(200);
    const limitada = await request(app).post("/api/v1/auth/login").send({ email: "a@b.co", password: "x" }).expect(429);
    expect(limitada.body.error).toBe("too_many_requests");
    expect(Number(limitada.headers["retry-after"])).toBeGreaterThan(0);
  });
});
