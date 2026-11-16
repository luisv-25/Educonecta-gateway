import { isPublicRoute, verifyJwt } from "../../src/auth";
import { RateLimiter, tierFor } from "../../src/rate-limit";

import { b64, firmar } from "../helpers/jwt";

describe("JWT y límite de peticiones del gateway (unitarias)", () => {
  it("Unitaria 5: acepta un JWT bien firmado y vigente; rechaza vencido, manipulado, con otro secreto o con alg none", () => {
    const ahora = 1_800_000_000;
    expect(verifyJwt(firmar({ sub: "u1", role: "tutor", exp: ahora + 60 }), "secreto", ahora)).toMatchObject({ sub: "u1", role: "tutor" });
    expect(verifyJwt(firmar({ sub: "u1", exp: ahora - 1 }), "secreto", ahora)).toBeNull(); // vencido
    expect(verifyJwt(firmar({ sub: "u1", exp: ahora + 60 }, "otro"), "secreto", ahora)).toBeNull(); // otro secreto
    const t = firmar({ sub: "u1", role: "student", exp: ahora + 60 });
    const [h, , s] = t.split(".");
    expect(verifyJwt(`${h}.${b64({ sub: "u1", role: "admin", exp: ahora + 60 })}.${s}`, "secreto", ahora)).toBeNull(); // payload alterado
    expect(verifyJwt(`${b64({ alg: "none" })}.${b64({ sub: "x" })}.`, "secreto", ahora)).toBeNull(); // alg none
    expect(verifyJwt("basura", "secreto", ahora)).toBeNull();
  });

  it("Unitaria 6: solo son públicas las rutas del catálogo, login/registro y consultas que el frontend usa sin sesión", () => {
    expect(isPublicRoute("POST", "/api/v1/auth/login")).toBe(true);
    expect(isPublicRoute("GET", "/api/v1/tutors?subjectId=1")).toBe(true);
    expect(isPublicRoute("GET", "/api/v1/tutors/9/profile")).toBe(true);
    expect(isPublicRoute("GET", "/api/v1/shared-links/abc")).toBe(true);
    expect(isPublicRoute("GET", "/api/v1/bookings?tutorId=1")).toBe(true);
    expect(isPublicRoute("GET", "/api/v1/bookings/5")).toBe(true);
    expect(isPublicRoute("POST", "/api/v1/bookings")).toBe(false); // crear exige token
    expect(isPublicRoute("PATCH", "/api/v1/bookings/5/accept")).toBe(false);
    expect(isPublicRoute("PATCH", "/api/v1/tutors/9/profile")).toBe(false); // escribir exige token
    expect(isPublicRoute("POST", "/api/v1/subjects")).toBe(false);
    expect(isPublicRoute("PATCH", "/api/v1/users/9/availability")).toBe(false);
    expect(isPublicRoute("PATCH", "/api/v1/sessions/1/end")).toBe(false);
    expect(isPublicRoute("GET", "/api/v1/payouts")).toBe(false);
    expect(isPublicRoute("GET", "/api/v1/analytics/dashboard")).toBe(false);
  });

  it("Unitaria 7: el limitador cuenta por IP y nivel, bloquea al pasar el límite y se reinicia al terminar la ventana", () => {
    let t = 0;
    const rl = new RateLimiter({ auth: 2, catalog: 3, general: 5, windowMs: 60000 }, () => t);
    expect(rl.hit("1.1.1.1", "auth").allowed).toBe(true);
    expect(rl.hit("1.1.1.1", "auth").allowed).toBe(true);
    const bloqueada = rl.hit("1.1.1.1", "auth");
    expect(bloqueada).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    expect(rl.hit("2.2.2.2", "auth").allowed).toBe(true); // otra IP no se ve afectada
    expect(rl.hit("1.1.1.1", "general").allowed).toBe(true); // otro nivel tiene su propio contador
    t += 60000;
    expect(rl.hit("1.1.1.1", "auth").allowed).toBe(true); // ventana nueva
    expect(tierFor("POST", "/api/v1/auth/login")).toBe("auth");
    expect(tierFor("GET", "/api/v1/tutors?x=1")).toBe("catalog");
    expect(tierFor("POST", "/api/v1/bookings")).toBe("general");
  });
});
