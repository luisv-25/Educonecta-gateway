// Limitador de peticiones por IP en memoria (ventana fija de 1 minuto). Protege contra scraping
// masivo de perfiles y fuerza bruta de login. Tres niveles: autenticación (el más estricto),
// catálogo público (anti-scraping) y general.
export type LimitTier = "auth" | "catalog" | "general";

export interface RateLimitConfig { auth: number; catalog: number; general: number; windowMs: number }

export function tierFor(method: string, path: string): LimitTier {
  const p = path.split("?")[0];
  if (/^\/api\/v1\/auth\//.test(p)) return "auth";
  if (method.toUpperCase() === "GET" && /^\/api\/v1\/(tutors|subjects)(\/|$)/.test(p)) return "catalog";
  return "general";
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly cfg: RateLimitConfig, private readonly now: () => number = Date.now) {}

  /** Registra una petición; devuelve si se permite y cuántos segundos faltan para reiniciar la ventana. */
  hit(ip: string, tier: LimitTier): { allowed: boolean; limit: number; remaining: number; retryAfterSeconds: number } {
    const t = this.now();
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    const key = `${tier}:${ip}`;
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + this.cfg.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    const limit = this.cfg[tier];
    return {
      allowed: entry.count <= limit,
      limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)),
    };
  }
}
