# api-gateway

Punto de entrada único de **EduConecta**. Enruta `/api/v1/<recurso>/...` al microservicio dueño, valida el JWT (HS256), aplica límite de peticiones, circuit breaker y propaga un `x-correlation-id`. Maneja CORS para el frontend.

## Enrutamiento
| Prefijo `/api/v1/...` | Servicio |
|---|---|
| auth, users, credentials | user |
| tutors, subjects | catalog |
| bookings, matching | booking |
| sessions | session |
| packages, payouts, paypal, transactions, settlements | payment |
| progress, feedback | feedback |
| files, shared-links | content |
| notifications, preferences | notification |
| analytics | analytics |

Rutas públicas (sin token): registro/login, consulta de materias, tutores, reservas/usuarios (GET), token y QoS de sesión, etc. (ver `src/auth.ts`). El resto exige `Authorization: Bearer <jwt>`.

## Puesta en marcha
```bash
cd api-gateway
cp .env.example .env
npm install
npm run dev      # desarrollo
npm run build && npm start
```
`JWT_SECRET` debe ser **igual** al de los microservicios; si falta, el gateway solo enruta (`/ready` muestra `jwtValidation`).

## Operación
- `GET /health` · `GET /ready` (`?deep=true` consulta cada servicio) · `GET /metrics`
- Límites por minuto: auth 30, catálogo 300, general 600 (configurables).
- Pruebas: `npm test` (10 pruebas). CI/CD con GitHub Actions → Render (Deploy Hook).
