import { useEffect, useState } from "react";
import { decodeError, type DecodedError } from "@core/errors.js";
import type { Hex } from "@core/types.js";
import { useLedger } from "../state/LedgerContext";
import type { ReadingView } from "../types/app";

/**
 * Reading history of the given devices (all registered devices by default),
 * refetched whenever the ledger data changes. Sorted oldest → newest.
 */
export function useLedgerReadings(deviceIds?: Hex[]) {
  const { devices, dataVersion, getReadings, service } = useLedger();
  const [readings, setReadings] = useState<ReadingView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DecodedError | null>(null);
  const ids = (deviceIds ?? devices.map((d) => d.deviceId)).join(",");

  useEffect(() => {
    let cancelled = false;
    const list = ids ? (ids.split(",") as Hex[]) : [];
    if (list.length === 0 || !service) {
      setReadings([]);
      return;
    }
    setLoading(true);
    Promise.all(list.map((id) => getReadings(id)))
      .then((all) => {
        if (cancelled) return;
        setReadings(all.flat().sort((a, b) => Number(a.timestamp - b.timestamp) || a.index - b.index));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(decodeError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ids, dataVersion, getReadings, service]);

  return { readings, loading, error };
}
