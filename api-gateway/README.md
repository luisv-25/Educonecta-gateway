# API Gateway de EduConecta

Punto de entrada único (patrón API Gateway) delante de los 9 microservicios. El frontend ya no conoce 9 URLs, solo esta. Es un servicio **sin base de datos** (no guarda estado), por lo que no afecta la regla de "una BD por microservicio".

## Qué hace
| Función | Cómo |
|---|---|
| **Enrutamiento** | Por el primer segmento de la ruta `/api/v1/<segmento>/...` (tabla abajo). La ruta llega intacta al servicio. |
| **Correlation id** | Usa el `x-correlation-id` del cliente o crea uno; viaja a los microservicios, vuelve en la respuesta y queda en el log (JSON, una línea por petición). |
| **Circuit breaker** | Por servicio: 5 fallos seguidos (red, timeout, 502/503/504) abren el circuito 20 s → responde `503 circuit_open` al instante; luego deja pasar una prueba (semiabierto). Un servicio caído no bloquea a los demás. |
| **Timeout** | 90 s (cubre el arranque en frío del plan gratis de Render). `504 upstream_timeout` / `502 upstream_unreachable`. |
| **CORS** | Lo resuelve solo el gateway (quita los CORS de los servicios para no duplicarlos). `CORS_ORIGINS` opcional. |
| **Streaming** | No lee el cuerpo: pasan JSON grandes (PDF de credenciales) y multipart (material). |
| **Observabilidad** | `GET /metrics` (mismas métricas/etiquetas que los servicios + `gateway_circuit_state`, `gateway_upstream_failures_total`). |
| **Salud** | `GET /health` (vivo), `GET /ready` (listo; `?deep=true` consulta `/health` de cada servicio). |

## Tabla de rutas
| Segmentos | Servicio |
|---|---|
| auth, users, credentials | user-service |
| tutors, subjects | catalog-service |
| bookings, matching | booking-service |
| sessions | session-service |
| packages, payouts, paypal, transactions, settlements | payment-service |
| progress, feedback | feedback-service |
| files, shared-links | content-service |
| notifications, preferences | notification-service |
| analytics | analytics-service |

## Desplegar en Render
1. Repo nuevo en GitHub (p. ej. `Api-gateway`) con el contenido de esta carpeta **en la raíz** (`package.json`, `src/`, `Dockerfile`, `.github/`...).
2. Render → New → Web Service → ese repo → Runtime **Docker** → plan Free. **Nómbralo `educonecta-gateway`** (la URL será `https://educonecta-gateway.onrender.com`; si Render le agrega un sufijo, usa esa URL en el paso 4).
3. Variables de entorno: ninguna es obligatoria (las URLs de los 9 servicios ya vienen por defecto). Pon **Auto-Deploy en Off** y copia su **Deploy Hook** a un secreto `RENDER_DEPLOY_HOOK_URL` del repo en GitHub, igual que en los demás.
4. Vercel (frontend): variable `NEXT_PUBLIC_API_URL = https://<url-del-gateway>/api/v1` y redeploy. Reemplaza `lib/config.ts` del frontend por el incluido.
5. Prometheus: reemplaza `prometheus.yml` por el incluido (agrega el gateway).

## Local
```
npm install
npm run build && npm start      # http://localhost:3000
npm test                        # no requiere base de datos
```
