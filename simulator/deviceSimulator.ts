/**
 * Simulated crop-field edge AI device.
 *
 * Generates realistic soil readings (N, P, K in mg/kg, plus moisture,
 * temperature and pH), runs a tiny on-device anomaly detector (rolling
 * z-score — the "edge AI" part) and emits canonical payloads with a strictly
 * increasing nonce. Anomalies (sensor spike, calibration drift, contact
 * dropout) can be injected on demand to drive the demonstration.
 *
 * Values are synthetic. They are in plausible ranges for agricultural soil
 * tested with low-cost NPK probes, but do not represent any real field.
 */
import { PAYLOAD_SCHEMA } from "./payload.js";
import type { AnomalyLabel, ReadingPayload } from "./types.js";

export type AnomalyKind = "spike" | "drift" | "dropout";

export const ANOMALY_DESCRIPTIONS: Record<AnomalyKind, string> = {
  spike: "Sudden spike in one nutrient (e.g. fertilizer granule touching the probe)",
  drift: "Gradual calibration drift over several readings",
  dropout: "Probe loses soil contact; values collapse towards zero",
};

/** Typical baseline conditions for a field. */
export interface FieldProfile {
  label: string;
  n: number;
  p: number;
  k: number;
  moistureBp: number;
  tempCentiC: number;
  phCenti: number;
}

export const FIELD_PROFILES: Record<string, FieldProfile> = {
  "FIELD-A1": { label: "Paddy, loamy clay", n: 148, p: 34, k: 182, moistureBp: 3400, tempCentiC: 2650, phCenti: 655 },
  "FIELD-B7": { label: "Sugarcane, sandy loam", n: 118, p: 27, k: 214, moistureBp: 2600, tempCentiC: 2800, phCenti: 712 },
  "FIELD-C3": { label: "Groundnut, red soil", n: 96, p: 41, k: 158, moistureBp: 1900, tempCentiC: 2900, phCenti: 618 },
};

const DEFAULT_PROFILE: FieldProfile = FIELD_PROFILES["FIELD-A1"]!;

export interface DeviceConfig {
  deviceId: string;
  fieldId: string;
  firmware: string;
}

export interface SimulatorOptions {
  /** Last nonce already used by this device (next reading uses +1). */
  lastNonce?: number;
  /** Seed for reproducible readings. */
  seed?: number;
  /** Clock in milliseconds (defaults to Date.now). */
  clock?: () => number;
  /** Baseline profile; defaults to the field's profile or FIELD-A1. */
  profile?: FieldProfile;
}

export interface GeneratedReading {
  payload: ReadingPayload;
  /** Anomaly deliberately injected by the operator (simulation metadata, not signed). */
  injected: AnomalyKind | null;
}

/** z-score at or above which the edge model labels a reading as an anomaly. */
export const ANOMALY_THRESHOLD = 3;
const WINDOW = 20;
const WARM_UP = 5;

/** Small, fast, seedable PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export class EdgeDeviceSimulator {
  readonly config: DeviceConfig;
  readonly profile: FieldProfile;
  private lastNonce: number;
  private readonly random: () => number;
  private readonly clock: () => number;
  private readonly history: { n: number; p: number; k: number }[] = [];
  private pending: { kind: AnomalyKind; remaining: number; step: number } | null = null;
  private generated = 0;

  constructor(config: DeviceConfig, options: SimulatorOptions = {}) {
    this.config = config;
    this.profile = options.profile ?? FIELD_PROFILES[config.fieldId] ?? DEFAULT_PROFILE;
    this.lastNonce = options.lastNonce ?? 0;
    this.random = mulberry32(options.seed ?? Math.floor(Math.random() * 2 ** 32));
    this.clock = options.clock ?? Date.now;
  }

  /** Nonce that the next reading will use. */
  get nextNonce(): number {
    return this.lastNonce + 1;
  }

  /** Align the local counter with the chain (e.g. after a page reload). */
  syncLastNonce(lastNonce: number): void {
    if (lastNonce > this.lastNonce) this.lastNonce = lastNonce;
  }

  /** Inject an anomaly into the next reading(s). */
  injectAnomaly(kind: AnomalyKind): void {
    const length = kind === "drift" ? 6 : kind === "dropout" ? 2 : 1;
    this.pending = { kind, remaining: length, step: 0 };
  }

  get pendingAnomaly(): AnomalyKind | null {
    return this.pending?.kind ?? null;
  }

  /** Standard normal sample (Box–Muller). */
  private gaussian(): number {
    const u = Math.max(this.random(), 1e-12);
    const v = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Generate, but do not sign, the next reading. */
  generate(): GeneratedReading {
    const nowMs = this.clock();
    const timestamp = Math.floor(nowMs / 1000);
    const hour = new Date(nowMs).getUTCHours() + 5.5; // IST-like diurnal phase
    const diurnal = Math.sin(((hour - 9) / 24) * 2 * Math.PI);
    // Slow nutrient depletion as the crop takes up N and K.
    const depletion = 1 - Math.min(this.generated, 400) * 0.0004;

    let n = this.profile.n * depletion * (1 + 0.03 * this.gaussian());
    let p = this.profile.p * (1 + 0.035 * this.gaussian());
    let k = this.profile.k * (0.5 + 0.5 * depletion) * (1 + 0.025 * this.gaussian());
    let moisture = this.profile.moistureBp * (1 - 0.06 * diurnal) + 60 * this.gaussian();
    const temp = this.profile.tempCentiC + 380 * diurnal + 40 * this.gaussian();
    const ph = this.profile.phCenti + 4 * this.gaussian();

    let injected: AnomalyKind | null = null;
    if (this.pending) {
      injected = this.pending.kind;
      this.pending.step += 1;
      if (injected === "spike") {
        const which = Math.floor(this.random() * 3);
        const factor = 2.4 + this.random();
        if (which === 0) n *= factor;
        else if (which === 1) p *= factor;
        else k *= factor;
      } else if (injected === "drift") {
        const offset = 1 + 0.07 * this.pending.step;
        n *= offset;
        p *= offset;
        k *= offset;
      } else {
        n = 2 + 3 * this.random();
        p = 1 + 2 * this.random();
        k = 3 + 4 * this.random();
        moisture *= 0.15;
      }
      this.pending.remaining -= 1;
      if (this.pending.remaining <= 0) this.pending = null;
    }

    const reading = {
      n: Math.round(clamp(n, 0, 10_000)),
      p: Math.round(clamp(p, 0, 10_000)),
      k: Math.round(clamp(k, 0, 10_000)),
    };
    const score = this.anomalyScore(reading);
    const label: AnomalyLabel = score >= ANOMALY_THRESHOLD ? "anomaly" : "normal";
    // Keep the detector's baseline clean: only normal readings update it.
    if (label === "normal") {
      this.history.push(reading);
      if (this.history.length > WINDOW) this.history.shift();
    }

    this.lastNonce += 1;
    this.generated += 1;

    const payload: ReadingPayload = {
      schema: PAYLOAD_SCHEMA,
      deviceId: this.config.deviceId,
      fieldId: this.config.fieldId,
      firmware: this.config.firmware,
      timestamp,
      nonce: this.lastNonce,
      n: reading.n,
      p: reading.p,
      k: reading.k,
      soilMoistureBp: Math.round(clamp(moisture, 0, 10_000)),
      soilTempCentiC: Math.round(clamp(temp, -4_000, 8_000)),
      phCenti: Math.round(clamp(ph, 0, 1_400)),
      anomalyScoreMilli: Math.round(clamp(score, 0, 1_000) * 1000),
      anomalyLabel: label,
    };
    return { payload, injected };
  }

  /** Generate several readings at once. */
  burst(count: number): GeneratedReading[] {
    return Array.from({ length: count }, () => this.generate());
  }

  /** Max absolute z-score of N, P and K against the recent normal window. */
  private anomalyScore(reading: { n: number; p: number; k: number }): number {
    if (this.history.length < WARM_UP) return 0;
    let max = 0;
    for (const key of ["n", "p", "k"] as const) {
      const values = this.history.map((h) => h[key]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      // Floor the deviation so tiny natural variance doesn't explode the score.
      const std = Math.max(Math.sqrt(variance), mean * 0.02, 1);
      max = Math.max(max, Math.abs(reading[key] - mean) / std);
    }
    return Math.round(max * 1000) / 1000;
  }
}

/**
 * Runs a callback at a fixed interval (continuous simulation). Works in Node
 * and in the browser.
 */
export class SimulationLoop {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly tick: () => void | Promise<void>) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(intervalMs: number): void {
    if (intervalMs < 250) throw new Error("Interval must be at least 250 ms");
    this.stop();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
