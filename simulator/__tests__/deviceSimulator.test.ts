import { describe, expect, it } from "vitest";
import { EdgeDeviceSimulator, SimulationLoop } from "../deviceSimulator.js";
import { validatePayload } from "../payload.js";

const CONFIG = { deviceId: "CL-DEV-0001", fieldId: "FIELD-A1", firmware: "1.4.2" };
const fixedClock = () => Date.UTC(2026, 9, 18, 6, 30, 0);

function warmedUp(seed = 7) {
  const sim = new EdgeDeviceSimulator(CONFIG, { seed, clock: fixedClock });
  sim.burst(10);
  return sim;
}

describe("EdgeDeviceSimulator", () => {
  it("produces valid schema-v1 payloads in realistic ranges", () => {
    const sim = new EdgeDeviceSimulator(CONFIG, { seed: 1, clock: fixedClock });
    for (const { payload } of sim.burst(50)) {
      expect(() => validatePayload(payload)).not.toThrow();
      expect(payload.n).toBeGreaterThan(100);
      expect(payload.n).toBeLessThan(200);
      expect(payload.p).toBeGreaterThan(20);
      expect(payload.p).toBeLessThan(50);
      expect(payload.k).toBeGreaterThan(130);
      expect(payload.k).toBeLessThan(230);
      expect(payload.phCenti).toBeGreaterThan(600);
      expect(payload.phCenti).toBeLessThan(700);
    }
  });

  it("uses a strictly increasing nonce starting after lastNonce", () => {
    const sim = new EdgeDeviceSimulator(CONFIG, { lastNonce: 41, seed: 2 });
    expect(sim.nextNonce).toBe(42);
    const nonces = sim.burst(5).map((r) => r.payload.nonce);
    expect(nonces).toEqual([42, 43, 44, 45, 46]);
  });

  it("can be re-synchronised with the chain's last nonce", () => {
    const sim = new EdgeDeviceSimulator(CONFIG, { seed: 3 });
    sim.syncLastNonce(10);
    expect(sim.generate().payload.nonce).toBe(11);
    sim.syncLastNonce(5); // never goes backwards
    expect(sim.nextNonce).toBe(12);
  });

  it("is reproducible for the same seed and clock", () => {
    const a = new EdgeDeviceSimulator(CONFIG, { seed: 99, clock: fixedClock }).burst(5);
    const b = new EdgeDeviceSimulator(CONFIG, { seed: 99, clock: fixedClock }).burst(5);
    expect(a).toEqual(b);
  });

  it("labels normal readings as normal after warm-up", () => {
    const sim = warmedUp();
    const labels = sim.burst(20).map((r) => r.payload.anomalyLabel);
    expect(labels.filter((l) => l === "anomaly").length).toBeLessThanOrEqual(1);
  });

  it("flags an injected spike with the edge anomaly detector", () => {
    const sim = warmedUp();
    sim.injectAnomaly("spike");
    expect(sim.pendingAnomaly).toBe("spike");
    const { payload, injected } = sim.generate();
    expect(injected).toBe("spike");
    expect(payload.anomalyLabel).toBe("anomaly");
    expect(payload.anomalyScoreMilli).toBeGreaterThanOrEqual(3000);
    expect(sim.pendingAnomaly).toBeNull();
  });

  it("flags a probe dropout", () => {
    const sim = warmedUp(11);
    sim.injectAnomaly("dropout");
    const { payload } = sim.generate();
    expect(payload.n).toBeLessThan(10);
    expect(payload.anomalyLabel).toBe("anomaly");
  });

  it("applies calibration drift over several readings", () => {
    const sim = warmedUp(5);
    sim.injectAnomaly("drift");
    const drifted = sim.burst(6);
    expect(drifted.every((r) => r.injected === "drift")).toBe(true);
    expect(drifted.at(-1)!.payload.anomalyLabel).toBe("anomaly");
    expect(sim.generate().injected).toBeNull();
  });
});

describe("SimulationLoop", () => {
  it("starts and stops", () => {
    let ticks = 0;
    const loop = new SimulationLoop(() => {
      ticks += 1;
    });
    loop.start(1000);
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(ticks).toBe(0);
    expect(() => loop.start(10)).toThrow(/at least 250/);
  });
});
