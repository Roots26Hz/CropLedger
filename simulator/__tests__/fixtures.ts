import type { ReadingPayload } from "../types.js";

/** A realistic, valid schema-v1 payload used across unit tests. */
export const SAMPLE: ReadingPayload = {
  schema: "cropledger.reading.v1",
  deviceId: "CL-DEV-0001",
  fieldId: "FIELD-A1",
  firmware: "1.4.2",
  timestamp: 1_760_000_000,
  nonce: 1,
  n: 142,
  p: 38,
  k: 191,
  soilMoistureBp: 2345,
  soilTempCentiC: 2410,
  phCenti: 652,
  anomalyScoreMilli: 120,
  anomalyLabel: "normal",
};
