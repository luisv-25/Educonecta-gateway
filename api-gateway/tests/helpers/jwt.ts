import { createHmac } from "crypto";

export const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
// Firma un JWT HS256 de prueba (mismo formato que genera @nestjs/jwt en los microservicios).
export function firmar(payload: object, secret = "secreto", alg = "HS256") {
  const head = b64({ alg, typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

