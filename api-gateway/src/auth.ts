import { createHmac, timingSafeEqual } from "crypto";

// Validación de JWT en el gateway (HS256, el mismo algoritmo y secreto JWT_SECRET que firman/validan
// los microservicios). El gateway solo comprueba FIRMA y EXPIRACIÓN; los roles (estudiante/tutor/admin)
// siguen validándose dentro de cada microservicio (defensa en profundidad: dos capas).

export interface JwtPayload { sub?: string; role?: string; exp?: number; [k: string]: unknown }

const b64url = (b: Buffer) => b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function verifyJwt(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (header.alg !== "HS256") return null; // evita "alg: none" y cambios de algoritmo
    const expected = b64url(createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest());
    const a = Buffer.from(expected);
    const b = Buffer.from(parts[2]);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload: JwtPayload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload.exp === "number" && payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

// Rutas PÚBLICAS (sin token). Todo lo demás exige un JWT válido en el gateway.
// Coinciden con lo que el frontend consume sin sesión: login/registro, catálogo público
// (descubrimiento sin autenticación según el documento del proyecto), consulta de usuarios,
// salas y reseñas de tutores.
const PUBLIC: Array<[string, RegExp]> = [
  ["POST", /^\/api\/v1\/auth\/(register|login)$/],
  ["GET", /^\/api\/v1\/subjects$/],
  ["GET", /^\/api\/v1\/bookings(\/[^/]+)?$/], // el frontend lista/consulta reservas sin token
  ["GET", /^\/api\/v1\/tutors(\/[^/]+\/(profile|ratings))?$/],
  ["GET", /^\/api\/v1\/users(\/[^/]+(\/availability)?)?$/],
  ["GET", /^\/api\/v1\/sessions\/booking\/[^/]+$/],
  ["GET", /^\/api\/v1\/sessions\/[^/]+\/token$/],
  ["POST", /^\/api\/v1\/sessions\/[^/]+\/qos-samples$/],
  ["GET", /^\/api\/v1\/feedback\/tutor\/[^/]+$/],
  ["GET", /^\/api\/v1\/paypal\/status$/],
  ["GET", /^\/api\/v1\/shared-links\/[^/]+$/],
];

export function isPublicRoute(method: string, path: string): boolean {
  const pathname = path.split("?")[0].replace(/\/+$/, "");
  return PUBLIC.some(([m, re]) => m === method.toUpperCase() && re.test(pathname));
}
