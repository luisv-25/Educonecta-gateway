// Circuit breaker por servicio. Evita que, cuando un microservicio está caído o dormido, cada
// petición del cliente espere el timeout completo: tras N fallos seguidos el circuito se ABRE y
// el gateway responde 503 al instante; pasado el enfriamiento deja pasar UNA petición de prueba
// (HALF_OPEN) y, si funciona, se cierra de nuevo.
export type BreakerState = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;
  private probeStartedAt = 0;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  getState(): BreakerState {
    return this.state;
  }

  /** ¿Se permite enviar esta petición al servicio? */
  allow(): boolean {
    const t = this.now();
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (t - this.openedAt < this.cooldownMs) return false;
      this.state = "half_open";
      this.probeStartedAt = t;
      return true;
    }
    // half_open: solo una prueba a la vez (si la prueba se perdió, se permite otra tras el enfriamiento)
    if (t - this.probeStartedAt >= this.cooldownMs) {
      this.probeStartedAt = t;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    if (this.state === "half_open") {
      this.open();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.open();
  }

  private open(): void {
    this.state = "open";
    this.openedAt = this.now();
    this.failures = 0;
  }
}
