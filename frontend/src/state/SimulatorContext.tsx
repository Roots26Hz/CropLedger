/**
 * Edge-device simulation in the browser: generates readings with the shared
 * EdgeDeviceSimulator, signs them with the simulated device key (EIP-712, the
 * same code the contract tests use), stores the full payload in the off-chain
 * evidence store and submits through the active ledger back-end.
 *
 * In network mode every submission is a real transaction that MetaMask asks
 * the user to approve; nothing is ever sent without the user's action.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Wallet } from "ethers";
import { EdgeDeviceSimulator, type AnomalyKind } from "@core/deviceSimulator.js";
import { firmwareHashFor, isValidId, toBytes32Id } from "@core/ids.js";
import { signedReadingFromJson, signedReadingToJson } from "@core/serialization.js";
import { recoverReadingSigner, signReading } from "@core/signing.js";
import type { ReadingPayload, SignedReading } from "@core/types.js";
import type { LedgerResult } from "../services/ledger/types";
import { loadJson, newId, saveJson } from "../services/storage";
import type { FeedItem } from "../types/app";
import { useLedger } from "./LedgerContext";
import { useSettings } from "./SettingsContext";

const MAX_FEED = 150;

export interface SimDeviceOption {
  label: string;
  fieldLabel: string;
  firmware: string;
  registered: boolean;
  active: boolean;
  /** The ledger has a device with this ID but a different signing key. */
  conflict: boolean;
}

interface SimulatorContextValue {
  feed: FeedItem[];
  devices: SimDeviceOption[];
  selected: string | null;
  setSelected: (label: string) => void;
  running: boolean;
  intervalSec: number;
  setIntervalSec: (seconds: number) => void;
  autoSubmit: boolean;
  setAutoSubmit: (value: boolean) => void;
  pendingAnomaly: AnomalyKind | null;
  start: () => void;
  stop: () => void;
  generate: (count?: number) => Promise<FeedItem[]>;
  injectAnomaly: (kind: AnomalyKind) => void;
  submitItem: (id: string, options?: { forceBroadcast?: boolean }) => Promise<LedgerResult | null>;
  submitAllQueued: () => Promise<void>;
  clearFeed: () => void;
  /** Sign an arbitrary payload with a stored simulated device key. */
  signWith: (label: string, payload: ReadingPayload) => Promise<SignedReading>;
  /** Create a simulated device key and register it on the ledger (owner action). */
  createDevice: (label: string, fieldLabel: string, firmware: string) => Promise<LedgerResult>;
  /** Next payload for a device without adding it to the feed (attack lab). */
  nextPayload: (label: string) => ReadingPayload;
}

const SimulatorContext = createContext<SimulatorContextValue | null>(null);

export function SimulatorProvider({ children }: { children: ReactNode }) {
  const { scope } = useSettings();
  const ledger = useLedger();
  const { service, devices: ledgerDevices, deviceKeys, evidence, runWrite, writeBlocker, addDeviceKey } = ledger;

  const [feed, setFeed] = useState<FeedItem[]>(() => loadJson<FeedItem[]>(`feed.v1.${scope}`, []));
  const [selected, setSelectedState] = useState<string | null>(null);
  /** True once the user picked a device; until then the best device is auto-selected. */
  const [userSelected, setUserSelected] = useState(false);
  const [running, setRunning] = useState(false);
  const [intervalSec, setIntervalSec] = useState(5);
  const [autoSubmit, setAutoSubmit] = useState(service?.kind !== "evm");
  const [pendingAnomaly, setPendingAnomaly] = useState<AnomalyKind | null>(null);
  const simulators = useRef(new Map<string, EdgeDeviceSimulator>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const feedRef = useRef(feed);
  feedRef.current = feed;

  // Per-deployment feed; reset simulator instances when the scope changes.
  useEffect(() => {
    setFeed(loadJson<FeedItem[]>(`feed.v1.${scope}`, []));
    simulators.current.clear();
    setRunning(false);
    setUserSelected(false);
  }, [scope]);

  useEffect(() => {
    setAutoSubmit(service?.kind !== "evm");
  }, [service?.kind]);

  const devices = useMemo<SimDeviceOption[]>(
    () =>
      deviceKeys.map((k) => {
        const sameId = ledgerDevices.find((d) => d.label === k.label);
        const onLedger = sameId && sameId.signer.toLowerCase() === k.address.toLowerCase() ? sameId : undefined;
        return {
          label: k.label,
          fieldLabel: k.fieldLabel,
          firmware: k.firmware,
          registered: Boolean(onLedger),
          active: onLedger?.active ?? false,
          conflict: Boolean(sameId && !onLedger),
        };
      }),
    [deviceKeys, ledgerDevices],
  );

  // Default selection: first registered, active device with a local key. It
  // is re-evaluated as ledger data arrives until the user chooses explicitly.
  useEffect(() => {
    if (userSelected && selected && devices.some((d) => d.label === selected)) return;
    const preferred = devices.find((d) => d.registered && d.active) ?? devices.find((d) => !d.conflict) ?? devices[0];
    setSelectedState(preferred?.label ?? null);
  }, [devices, selected, userSelected]);

  const persistFeed = useCallback(
    (updater: (all: FeedItem[]) => FeedItem[]) => {
      setFeed((all) => {
        const next = updater(all).slice(0, MAX_FEED);
        saveJson(`feed.v1.${scope}`, next);
        return next;
      });
    },
    [scope],
  );

  /** Simulator for a device, with its nonce aligned to the ledger and the feed. */
  const simulatorFor = useCallback(
    (label: string) => {
      const key = deviceKeys.find((k) => k.label === label);
      if (!key) throw new Error(`No simulated key for ${label} in this browser.`);
      const id = `${scope}|${label}`;
      let sim = simulators.current.get(id);
      if (!sim) {
        sim = new EdgeDeviceSimulator({ deviceId: label, fieldId: key.fieldLabel, firmware: key.firmware });
        simulators.current.set(id, sim);
      }
      const onChain = ledgerDevices.find((d) => d.label === label);
      const feedMax = feedRef.current.filter((f) => f.deviceLabel === label).reduce((m, f) => Math.max(m, f.payload.nonce), 0);
      sim.syncLastNonce(Math.max(Number(onChain?.lastNonce ?? 0n), feedMax));
      return sim;
    },
    [deviceKeys, ledgerDevices, scope],
  );

  const signWith = useCallback(
    async (label: string, payload: ReadingPayload) => {
      const key = deviceKeys.find((k) => k.label === label);
      if (!key) throw new Error(`No simulated key for ${label} in this browser.`);
      if (!service) throw new Error("No ledger configured.");
      return signReading(new Wallet(key.privateKey), service.domain, payload);
    },
    [deviceKeys, service],
  );

  const nextPayload = useCallback((label: string) => simulatorFor(label).generate().payload, [simulatorFor]);

  const submitItem = useCallback(
    (id: string, options: { forceBroadcast?: boolean } = {}) => {
      const run = async (): Promise<LedgerResult | null> => {
        const item = feedRef.current.find((f) => f.id === id);
        if (!item || !service) return null;
        const signed = signedReadingFromJson(item.signed);
        const txId = newId();
        persistFeed((all) => all.map((f) => (f.id === id ? { ...f, txId } : f)));
        return runWrite(
          {
            id: txId,
            kind: "submitReading",
            label: `Reading nonce ${item.payload.nonce} from ${item.deviceLabel}`,
            deviceId: signed.message.deviceId,
            deviceLabel: item.deviceLabel,
            nonce: item.payload.nonce,
          },
          (opts) => service.submitReading(signed, { ...opts, forceBroadcast: options.forceBroadcast }),
        );
      };
      // Serialise submissions so nonces reach the contract in order.
      const next = queue.current.then(run, run);
      queue.current = next.catch(() => undefined);
      return next;
    },
    [service, runWrite, persistFeed],
  );

  const generate = useCallback(
    async (count = 1) => {
      if (!selected || !service) return [];
      const sim = simulatorFor(selected);
      const key = deviceKeys.find((k) => k.label === selected)!;
      const signer = new Wallet(key.privateKey);
      const items: FeedItem[] = [];
      for (let i = 0; i < count; i++) {
        const { payload, injected } = sim.generate();
        const signed = await signReading(signer, service.domain, payload);
        const json = signedReadingToJson(signed);
        evidence.put(json);
        items.push({
          id: newId(),
          deviceLabel: selected,
          fieldLabel: key.fieldLabel,
          payload,
          injected,
          signed: json,
          signatureValid: recoverReadingSigner(service.domain, signed.message, signed.signature) === key.address,
          createdAt: Date.now(),
        });
      }
      setPendingAnomaly(sim.pendingAnomaly);
      persistFeed((all) => [...items.reverse(), ...all]);
      if (autoSubmit && !writeBlocker) {
        for (const item of [...items].reverse()) void submitItem(item.id);
      }
      return items;
    },
    [selected, service, simulatorFor, deviceKeys, evidence, persistFeed, autoSubmit, writeBlocker, submitItem],
  );

  // Continuous simulation loop (always calls the latest generate()).
  const generateRef = useRef(generate);
  generateRef.current = generate;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void generateRef.current(1), intervalSec * 1000);
    return () => clearInterval(timer);
  }, [running, intervalSec]);

  const injectAnomaly = useCallback(
    (kind: AnomalyKind) => {
      if (!selected) return;
      simulatorFor(selected).injectAnomaly(kind);
      setPendingAnomaly(kind);
    },
    [selected, simulatorFor],
  );

  const submitAllQueued = useCallback(async () => {
    const queued = feedRef.current.filter((f) => !f.txId).sort((a, b) => a.payload.nonce - b.payload.nonce);
    for (const item of queued) await submitItem(item.id);
  }, [submitItem]);

  const clearFeed = useCallback(() => persistFeed(() => []), [persistFeed]);

  const createDevice = useCallback(
    async (label: string, fieldLabel: string, firmware: string): Promise<LedgerResult> => {
      const fail = (message: string): LedgerResult => ({ ok: false, stage: "failed", at: Date.now(), error: { kind: "validation", message } });
      if (!service) return fail("No ledger configured.");
      if (!isValidId(label)) return fail("Device ID must be 1-31 characters: letters, digits, '.', '_', ':' or '-'.");
      if (!isValidId(fieldLabel)) return fail("Field ID must be 1-31 characters: letters, digits, '.', '_', ':' or '-'.");
      if (!firmware.trim()) return fail("Firmware version is required.");
      if (ledgerDevices.some((d) => d.label === label)) return fail(`${label} is already registered on this ledger (IDs are never reused).`);
      const existing = deviceKeys.find((k) => k.label === label);
      const key = existing ? new Wallet(existing.privateKey) : Wallet.createRandom();
      if (!existing) {
        addDeviceKey({ label, fieldLabel, firmware, address: key.address, privateKey: key.privateKey, createdAt: Date.now() });
      }
      return runWrite({ kind: "registerDevice", label: `Register ${label} (${fieldLabel})`, deviceId: toBytes32Id(label), deviceLabel: label }, (opts) =>
        service.registerDevice(toBytes32Id(label), key.address, toBytes32Id(fieldLabel), firmwareHashFor(firmware), opts),
      );
    },
    [service, ledgerDevices, deviceKeys, addDeviceKey, runWrite],
  );

  const value = useMemo<SimulatorContextValue>(
    () => ({
      feed,
      devices,
      selected,
      setSelected: (label: string) => {
        setUserSelected(true);
        setSelectedState(label);
      },
      running,
      intervalSec,
      setIntervalSec,
      autoSubmit,
      setAutoSubmit,
      pendingAnomaly,
      start: () => setRunning(true),
      stop: () => setRunning(false),
      generate,
      injectAnomaly,
      submitItem,
      submitAllQueued,
      clearFeed,
      signWith,
      createDevice,
      nextPayload,
    }),
    [feed, devices, selected, running, intervalSec, autoSubmit, pendingAnomaly, generate, injectAnomaly, submitItem, submitAllQueued, clearFeed, signWith, createDevice, nextPayload],
  );

  return <SimulatorContext.Provider value={value}>{children}</SimulatorContext.Provider>;
}

export function useSimulator(): SimulatorContextValue {
  const ctx = useContext(SimulatorContext);
  if (!ctx) throw new Error("useSimulator must be used inside SimulatorProvider");
  return ctx;
}
