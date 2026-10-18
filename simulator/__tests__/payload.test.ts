import { describe, expect, it } from "vitest";
import {
  PayloadValidationError,
  canonicalize,
  hashPayload,
  parsePayloadJson,
  validatePayload,
} from "../payload.js";
import type { ReadingPayload } from "../types.js";
import { SAMPLE } from "./fixtures.js";

describe("canonical payload", () => {
  it("serializes keys in the fixed schema order without whitespace", () => {
    expect(canonicalize(SAMPLE)).toBe(
      '{"schema":"cropledger.reading.v1","deviceId":"CL-DEV-0001","fieldId":"FIELD-A1",' +
        '"firmware":"1.4.2","timestamp":1760000000,"nonce":1,"n":142,"p":38,"k":191,' +
        '"soilMoistureBp":2345,"soilTempCentiC":2410,"phCenti":652,"anomalyScoreMilli":120,' +
        '"anomalyLabel":"normal"}',
    );
  });

  it("is independent of the input key order", () => {
    const shuffled = Object.fromEntries(Object.entries(SAMPLE).reverse()) as unknown as ReadingPayload;
    expect(canonicalize(shuffled)).toBe(canonicalize(SAMPLE));
    expect(hashPayload(shuffled)).toBe(hashPayload(SAMPLE));
  });

  it("produces a stable keccak256 hash", () => {
    const hash = hashPayload(SAMPLE);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashPayload({ ...SAMPLE })).toBe(hash);
  });

  it("changes the hash when any single field changes", () => {
    const original = hashPayload(SAMPLE);
    expect(hashPayload({ ...SAMPLE, n: 143 })).not.toBe(original);
    expect(hashPayload({ ...SAMPLE, timestamp: SAMPLE.timestamp + 1 })).not.toBe(original);
    expect(hashPayload({ ...SAMPLE, anomalyLabel: "anomaly" })).not.toBe(original);
    expect(hashPayload({ ...SAMPLE, fieldId: "FIELD-A2" })).not.toBe(original);
  });

  it("round-trips through JSON text", () => {
    const text = JSON.stringify(SAMPLE, null, 2);
    expect(hashPayload(parsePayloadJson(text))).toBe(hashPayload(SAMPLE));
  });
});

describe("payload validation", () => {
  const cases: [string, unknown][] = [
    ["non-integer nutrient", { ...SAMPLE, n: 142.5 }],
    ["negative nutrient", { ...SAMPLE, p: -1 }],
    ["nutrient above contract bound", { ...SAMPLE, k: 10_001 }],
    ["zero nonce", { ...SAMPLE, nonce: 0 }],
    ["string number", { ...SAMPLE, n: "142" }],
    ["bad device id", { ...SAMPLE, deviceId: "has spaces" }],
    ["device id too long", { ...SAMPLE, deviceId: "X".repeat(32) }],
    ["wrong schema", { ...SAMPLE, schema: "v2" }],
    ["bad label", { ...SAMPLE, anomalyLabel: "weird" }],
    ["unknown key", { ...SAMPLE, extra: 1 }],
    ["missing key", (({ k: _omit, ...rest }) => rest)(SAMPLE)],
    ["not an object", [1, 2, 3]],
  ];

  it.each(cases)("rejects %s", (_label, value) => {
    expect(() => validatePayload(value)).toThrow(PayloadValidationError);
  });

  it("rejects malformed JSON text with a clear error", () => {
    expect(() => parsePayloadJson("{not json")).toThrow(/not valid JSON/);
  });
});
