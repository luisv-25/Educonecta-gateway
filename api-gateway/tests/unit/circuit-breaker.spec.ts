import { CircuitBreaker } from "../../src/circuit-breaker";

describe("CircuitBreaker (unitarias)", () => {
  it("Unitaria 3: se abre tras N fallos seguidos, rechaza durante el enfriamiento y un éxito reinicia la cuenta", () => {
    let t = 1000;
    const cb = new CircuitBreaker(3, 10000, () => t);
    cb.recordFailure(); cb.recordFailure();
    cb.recordSuccess(); // reinicia: los fallos no son acumulativos si hubo éxito en medio
    cb.recordFailure(); cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.allow()).toBe(false);
    t += 9999;
    expect(cb.allow()).toBe(false);
  });

  it("Unitaria 4: tras el enfriamiento deja pasar UNA prueba (semiabierto); si funciona cierra, si falla vuelve a abrir", () => {
    let t = 0;
    const cb = new CircuitBreaker(1, 5000, () => t);
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    t += 5000;
    expect(cb.allow()).toBe(true); // petición de prueba
    expect(cb.getState()).toBe("half_open");
    expect(cb.allow()).toBe(false); // solo una a la vez
    cb.recordFailure(); // la prueba falló
    expect(cb.getState()).toBe("open");
    t += 5000;
    expect(cb.allow()).toBe(true);
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.allow()).toBe(true);
  });
});
