// Tabla de enrutamiento del API Gateway: primer segmento de la ruta (/api/v1/<segmento>/...)
// -> microservicio que la atiende. Es la ÚNICA fuente de verdad de "qué ruta va a qué servicio".
export type ServiceName =
  | "user" | "catalog" | "booking" | "session" | "payment"
  | "feedback" | "content" | "notification" | "analytics";

export interface ServiceRoute {
  name: ServiceName;
  /** Primer segmento de ruta (después de /api/v1) que atiende este servicio. */
  segments: string[];
  /** Variable de entorno con la URL base (sin /api/v1). */
  envVar: string;
  /** URL por defecto (Render). */
  defaultUrl: string;
}

export const API_PREFIX = "/api/v1";

export const SERVICE_ROUTES: ServiceRoute[] = [
  { name: "user", segments: ["auth", "users", "credentials"], envVar: "USER_SERVICE_URL", defaultUrl: "https://user-service-i7q4.onrender.com" },
  { name: "catalog", segments: ["tutors", "subjects"], envVar: "CATALOG_SERVICE_URL", defaultUrl: "https://catalog-service-uree.onrender.com" },
  { name: "booking", segments: ["bookings", "matching"], envVar: "BOOKING_SERVICE_URL", defaultUrl: "https://booking-services-y22o.onrender.com" },
  { name: "session", segments: ["sessions"], envVar: "SESSION_SERVICE_URL", defaultUrl: "https://session-services.onrender.com" },
  { name: "payment", segments: ["packages", "payouts", "paypal", "transactions", "settlements"], envVar: "PAYMENT_SERVICE_URL", defaultUrl: "https://payment-service-ogh1.onrender.com" },
  { name: "feedback", segments: ["progress", "feedback"], envVar: "FEEDBACK_SERVICE_URL", defaultUrl: "https://feedback-service-o417.onrender.com" },
  { name: "content", segments: ["files", "shared-links"], envVar: "CONTENT_SERVICE_URL", defaultUrl: "https://content-service-rsbo.onrender.com" },
  { name: "notification", segments: ["notifications", "preferences"], envVar: "NOTIFICATION_SERVICE_URL", defaultUrl: "https://notificacion-service-rlnh.onrender.com" },
  { name: "analytics", segments: ["analytics"], envVar: "ANALYTICS_SERVICE_URL", defaultUrl: "https://analytics-service-ejtf.onrender.com" },
];

/** Devuelve qué servicio atiende una ruta como "/api/v1/users/123?x=1", o null si ninguno. */
export function resolveService(path: string): { service: ServiceName; segment: string } | null {
  const pathname = path.split("?")[0];
  if (!pathname.startsWith(API_PREFIX + "/")) return null;
  const segment = pathname.slice(API_PREFIX.length + 1).split("/")[0];
  if (!segment) return null;
  const found = SERVICE_ROUTES.find((r) => r.segments.includes(segment));
  return found ? { service: found.name, segment } : null;
}

/** Lee las URLs de los servicios del entorno (o usa las de Render por defecto). */
export function loadUpstreams(env: NodeJS.ProcessEnv = process.env): Record<ServiceName, string> {
  const out = {} as Record<ServiceName, string>;
  for (const r of SERVICE_ROUTES) out[r.name] = (env[r.envVar] || r.defaultUrl).replace(/\/+$/, "");
  return out;
}
