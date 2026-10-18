/**
 * Ledger state: picks the back-end (local demo or EVM network), loads the
 * device registry and totals, tracks write operations started from this
 * browser, and keeps the off-chain evidence store (full payloads) that the
 * on-chain hashes protect.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { decodeError, type DecodedError } from "@core/errors.js";
import { chainLabel } from "@core/networks.js";
import type { SignedReadingJson } from "@core/serialization.js";
import type { Hex } from "@core/types.js";
import { EvmLedgerService } from "../services/ledger/evmLedgerService";
import { LocalLedgerService } from "../services/ledger/localLedgerService";
import type { LedgerResult, LedgerService, LedgerUpdate, WriteOptions } from "../services/ledger/types";
import { loadJson, newId, saveJson } from "../services/storage";
import type { DeviceInfo, ReadingView, SimDeviceKey, TxKind, TxRecord } from "../types/app";
import { useSettings } from "./SettingsContext";
import { useWallet } from "./WalletContext";

const MAX_TXS = 200;
const DEVICE_KEYS = "deviceKeys.v1";

export interface WriteMeta {
  /** Optional pre-allocated record ID (lets callers link UI items to the record). */
  id?: string;
  kind: TxKind;
  label: string;
  deviceId?: Hex;
  deviceLabel?: string;
  nonce?: number;
}

interface LedgerContextValue {
  service: LedgerService | null;
  status: "idle" | "loading" | "ready" | "error";
  error: DecodedError | null;
  devices: DeviceInfo[];
  owner: string | null;
  totalReadings: number;
  blockNumber: number | null;
  /** Connected account's native-token balance in wei (network mode). */
  walletBalance: bigint | null;
  lastUpdated: number | null;
  /** Increments whenever ledger data may have changed (pages refetch). */
  dataVersion: number;
  txs: TxRecord[];
  /** Reason writes are impossible right now (null when writes are possible). */
  writeBlocker: string | null;
  /** Reason owner-only actions are impossible (null when allowed). */
  ownerBlocker: string | null;
  refresh: () => Promise<void>;
  getReadings: (deviceId: Hex) => Promise<ReadingView[]>;
  runWrite: (meta: WriteMeta, exec: (options: WriteOptions) => Promise<LedgerResult>) => Promise<LedgerResult>;
  clearTxs: () => void;
  evidence: {
    get: (deviceLabel: string, nonce: number | bigint) => SignedReadingJson | undefined;
    put: (signed: SignedReadingJson) => void;
    all: () => SignedReadingJson[];
    importMany: (items: SignedReadingJson[]) => number;
    clear: () => void;
  };
  deviceKeys: SimDeviceKey[];
  addDeviceKey: (key: SimDeviceKey) => void;
  forgetDeviceKeys: () => void;
}

const LedgerContext = createContext<LedgerContextValue | null>(null);

function evidenceKey(scope: string) {
  return `evidence.v1.${scope}`;
}
function txKey(scope: string) {
  return `txlog.v1.${scope}`;
}
function evidenceId(deviceLabel: string, nonce: number | bigint | string) {
  return `${deviceLabel}#${nonce.toString()}`;
}

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { settings, scope, networkConfigured } = useSettings();
  const wallet = useWallet();

  const service = useMemo<LedgerService | null>(() => {
    if (settings.mode === "local") return new LocalLedgerService();
    if (!networkConfigured) return null;
    try {
      return new EvmLedgerService({
        chainId: settings.chainId,
        address: settings.contractAddress,
        rpcUrl: settings.rpcUrl,
        signerSource: wallet.signerSource,
      });
    } catch {
      return null;
    }
  }, [settings.mode, settings.chainId, settings.contractAddress, settings.rpcUrl, networkConfigured, wallet.signerSource]);

  const [status, setStatus] = useState<LedgerContextValue["status"]>("idle");
  const [error, setError] = useState<DecodedError | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [totalReadings, setTotalReadings] = useState(0);
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [txs, setTxs] = useState<TxRecord[]>(() => loadJson<TxRecord[]>(txKey(scope), []));
  const [evidenceMap, setEvidenceMap] = useState<Record<string, SignedReadingJson>>(() => loadJson(evidenceKey(scope), {}));
  const [deviceKeys, setDeviceKeys] = useState<SimDeviceKey[]>(() => loadJson<SimDeviceKey[]>(DEVICE_KEYS, []));
  const serviceRef = useRef(service);
  serviceRef.current = service;

  // Reload per-scope browser data when the deployment changes.
  useEffect(() => {
    setTxs(loadJson<TxRecord[]>(txKey(scope), []));
    setEvidenceMap(loadJson(evidenceKey(scope), {}));
  }, [scope]);

  const refresh = useCallback(async () => {
    const svc = serviceRef.current;
    if (!svc) {
      setStatus("idle");
      setDevices([]);
      setOwner(null);
      setTotalReadings(0);
      return;
    }
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const [list, own, total] = await Promise.all([svc.listDevices(), svc.getOwner(), svc.getTotalReadings()]);
      if (serviceRef.current !== svc) return; // stale
      setDevices(list);
      setOwner(own);
      setTotalReadings(total);
      setError(null);
      setStatus("ready");
      setLastUpdated(Date.now());
      setDataVersion((v) => v + 1);
    } catch (e) {
      if (serviceRef.current !== svc) return;
      setError(decodeError(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    setDevices([]);
    setOwner(null);
    setBlockNumber(null);
    void refresh();
  }, [service, refresh]);

  // Network mode: follow the chain head (for confirmations) and pick up
  // readings submitted elsewhere (e.g. by the CLI gateway).
  useEffect(() => {
    if (!service || service.kind !== "evm" || !service.getBlockNumber) return;
    let cancelled = false;
    let ticks = 0;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const n = await service.getBlockNumber!();
        if (!cancelled) setBlockNumber(n);
      } catch {
        // Surface RPC problems through refresh() instead.
      }
      ticks += 1;
      if (ticks % 4 === 0) void refresh();
    };
    void poll();
    const timer = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [service, refresh]);

  // Network mode: the connected account's native-token balance (gas money).
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  useEffect(() => {
    setWalletBalance(null);
    const account = wallet.account;
    if (!service || service.kind !== "evm" || !service.getBalance || !account) return;
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const balance = await service.getBalance!(account);
        if (!cancelled) setWalletBalance(balance);
      } catch {
        // Shown as unknown.
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [service, wallet.account, dataVersion]);

  const getReadings = useCallback(async (deviceId: Hex) => {
    const svc = serviceRef.current;
    return svc ? svc.getReadings(deviceId) : [];
  }, []);

  const persistTxs = useCallback(
    (updater: (all: TxRecord[]) => TxRecord[]) => {
      setTxs((all) => {
        const next = updater(all).slice(0, MAX_TXS);
        saveJson(txKey(scope), next);
        return next;
      });
    },
    [scope],
  );

  const runWrite = useCallback(
    async (meta: WriteMeta, exec: (options: WriteOptions) => Promise<LedgerResult>) => {
      const svc = serviceRef.current;
      const id = meta.id ?? newId();
      const now = Date.now();
      const record: TxRecord = {
        ...meta,
        id,
        local: svc?.kind !== "evm",
        chainId: svc?.chainId ?? null,
        stage: "validating",
        stages: [],
        createdAt: now,
        updatedAt: now,
      };
      persistTxs((all) => [record, ...all]);

      const onUpdate = (u: LedgerUpdate) => {
        persistTxs((all) =>
          all.map((t) =>
            t.id !== id
              ? t
              : {
                  ...t,
                  stage: u.stage,
                  stages: [...t.stages, { stage: u.stage, at: u.at, note: u.note }],
                  txHash: u.txHash ?? t.txHash,
                  localRef: u.localRef ?? t.localRef,
                  blockNumber: u.blockNumber ?? t.blockNumber,
                  gasUsed: u.gasUsed !== undefined ? u.gasUsed.toString() : t.gasUsed,
                  readingIndex: u.readingIndex ?? t.readingIndex,
                  error: u.error ?? t.error,
                  updatedAt: u.at,
                },
          ),
        );
      };

      let result: LedgerResult;
      try {
        result = await exec({ onUpdate });
      } catch (e) {
        result = { ok: false, stage: "failed", at: Date.now(), error: decodeError(e) };
        onUpdate(result);
      }
      if (result.txHash || result.localRef || result.ok) void refresh();
      return result;
    },
    [persistTxs, refresh],
  );

  const clearTxs = useCallback(() => persistTxs(() => []), [persistTxs]);

  const evidence = useMemo<LedgerContextValue["evidence"]>(
    () => ({
      get: (deviceLabel, nonce) => evidenceMap[evidenceId(deviceLabel, nonce)],
      put: (signed) => {
        setEvidenceMap((m) => {
          const next = { ...m, [evidenceId(signed.payload.deviceId, signed.payload.nonce)]: signed };
          saveJson(evidenceKey(scope), next);
          return next;
        });
      },
      all: () => Object.values(evidenceMap),
      importMany: (items) => {
        const next = { ...evidenceMap };
        let count = 0;
        for (const item of items) {
          if (item?.kind !== "cropledger.signed-reading") continue;
          next[evidenceId(item.payload.deviceId, item.payload.nonce)] = item;
          count += 1;
        }
        saveJson(evidenceKey(scope), next);
        setEvidenceMap(next);
        return count;
      },
      clear: () => {
        saveJson(evidenceKey(scope), {});
        setEvidenceMap({});
      },
    }),
    [evidenceMap, scope],
  );

  const addDeviceKey = useCallback((key: SimDeviceKey) => {
    setDeviceKeys((all) => {
      const next = [...all.filter((k) => k.label !== key.label), key];
      saveJson(DEVICE_KEYS, next);
      return next;
    });
  }, []);

  const forgetDeviceKeys = useCallback(() => {
    saveJson(DEVICE_KEYS, []);
    setDeviceKeys([]);
  }, []);

  const writeBlocker = useMemo(() => {
    if (settings.mode === "local") return null;
    if (!service) return "Set a deployed contract address in System Configuration first.";
    if (wallet.status === "unavailable") return "Install MetaMask to sign transactions.";
    if (wallet.status !== "connected") return "Connect your wallet (top-right) to send transactions.";
    if (wallet.chainId !== settings.chainId) return `Switch your wallet to ${chainLabel(settings.chainId)}.`;
    return null;
  }, [settings.mode, settings.chainId, service, wallet.status, wallet.chainId]);

  const ownerBlocker = useMemo(() => {
    if (writeBlocker) return writeBlocker;
    if (settings.mode === "local") return null;
    if (!owner) return "Contract owner not loaded yet.";
    if (wallet.account?.toLowerCase() !== owner.toLowerCase()) {
      return `Only the contract owner (${owner.slice(0, 8)}…) can register or revoke devices. Connect that account in MetaMask.`;
    }
    return null;
  }, [writeBlocker, settings.mode, owner, wallet.account]);

  const value = useMemo<LedgerContextValue>(
    () => ({
      service,
      status,
      error,
      devices,
      owner,
      totalReadings,
      blockNumber,
      walletBalance,
      lastUpdated,
      dataVersion,
      txs,
      writeBlocker,
      ownerBlocker,
      refresh,
      getReadings,
      runWrite,
      clearTxs,
      evidence,
      deviceKeys,
      addDeviceKey,
      forgetDeviceKeys,
    }),
    [service, status, error, devices, owner, totalReadings, blockNumber, walletBalance, lastUpdated, dataVersion, txs, writeBlocker, ownerBlocker, refresh, getReadings, runWrite, clearTxs, evidence, deviceKeys, addDeviceKey, forgetDeviceKeys],
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerContextValue {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error("useLedger must be used inside LedgerProvider");
  return ctx;
}
