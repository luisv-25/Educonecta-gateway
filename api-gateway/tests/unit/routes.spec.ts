import { loadUpstreams, resolveService, SERVICE_ROUTES } from "../../src/routes";

describe("Enrutamiento del API Gateway (unitarias)", () => {
  it("Unitaria 1: cada ruta pública de los 9 microservicios se asigna al servicio correcto", () => {
    const casos: Array<[string, string]> = [
      ["/api/v1/auth/login", "user"],
      ["/api/v1/users/123/credentials", "user"],
      ["/api/v1/credentials/pending", "user"],
      ["/api/v1/tutors/abc/ratings?x=1", "catalog"],
      ["/api/v1/subjects", "catalog"],
      ["/api/v1/bookings/9/accept", "booking"],
      ["/api/v1/matching/search", "booking"],
      ["/api/v1/sessions/5/token", "session"],
      ["/api/v1/transactions/7/paypal/capture", "payment"],
      ["/api/v1/payouts/open", "payment"],
      ["/api/v1/settlements/tutor/1", "payment"],
      ["/api/v1/progress/student/2", "feedback"],
      ["/api/v1/feedback/tutor/2", "feedback"],
      ["/api/v1/files/1/download", "content"],
      ["/api/v1/shared-links/tok", "content"],
      ["/api/v1/notifications", "notification"],
      ["/api/v1/preferences/u1", "notification"],
      ["/api/v1/analytics/dashboard", "analytics"],
    ];
    for (const [ruta, servicio] of casos) expect(resolveService(ruta)?.service).toBe(servicio);
    // ningún segmento está asignado a dos servicios a la vez
    const segs = SERVICE_ROUTES.flatMap((r) => r.segments);
    expect(new Set(segs).size).toBe(segs.length);
  });

  it("Unitaria 2: rutas desconocidas o fuera de /api/v1 no se enrutan; las URLs salen del entorno con valores por defecto", () => {
    expect(resolveService("/api/v1/desconocido/x")).toBeNull();
    expect(resolveService("/api/v1/")).toBeNull();
    expect(resolveService("/users")).toBeNull();
    const url = loadUpstreams({ USER_SERVICE_URL: "http://localhost:4001///" } as any);
    expect(url.user).toBe("http://localhost:4001"); // sin barras finales
    expect(url.catalog).toMatch(/^https:\/\/catalog-service/); // por defecto (Render)
  });
});
