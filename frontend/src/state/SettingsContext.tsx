import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { isAddress } from "ethers";
import { getNetwork, POLYGON_AMOY } from "@core/networks.js";
import { ENV } from "../config/env";
import { loadJson, saveJson } from "../services/storage";
import type { AppMode, Settings } from "../types/app";

const SETTINGS_KEY = "settings.v1";
const MODE_KEY = "mode.v1";

function envDefaults(): Settings {
  const chainId = ENV.chainId ?? POLYGON_AMOY.chainId;
  return {
    mode: ENV.chainId && ENV.contractAddress ? "network" : "local",
    chainId,
    contractAddress: ENV.contractAddress ?? "",
    rpcUrl: ENV.rpcUrl ?? getNetwork(chainId)!.defaultRpcUrl,
    deployBlock: ENV.deployBlock,
    source: "env",
  };
}

function loadInitial(): Settings {
  const defaults = envDefaults();
  const saved = loadJson<Settings | null>(SETTINGS_KEY, null);
  const base = saved && saved.source === "user" && getNetwork(saved.chainId) ? { ...defaults, ...saved } : defaults;
  const mode = loadJson<AppMode | null>(MODE_KEY, null);
  return { ...base, mode: mode === "local" || mode === "network" ? mode : base.mode };
}

interface SettingsContextValue {
  settings: Settings;
  /** Storage scope for per-deployment browser data. */
  scope: string;
  /** True when network mode has a syntactically valid contract address. */
  networkConfigured: boolean;
  setMode: (mode: AppMode) => void;
  saveNetworkSettings: (patch: Pick<Settings, "chainId" | "contractAddress" | "rpcUrl" | "deployBlock">) => void;
  resetToEnv: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadInitial);

  const setMode = useCallback((mode: AppMode) => {
    saveJson(MODE_KEY, mode);
    setSettings((s) => ({ ...s, mode }));
  }, []);

  const saveNetworkSettings = useCallback(
    (patch: Pick<Settings, "chainId" | "contractAddress" | "rpcUrl" | "deployBlock">) => {
      setSettings((s) => {
        const next: Settings = { ...s, ...patch, source: "user" };
        saveJson(SETTINGS_KEY, next);
        return next;
      });
    },
    [],
  );

  const resetToEnv = useCallback(() => {
    saveJson(SETTINGS_KEY, null);
    setSettings((s) => ({ ...envDefaults(), mode: s.mode }));
  }, []);

  const value = useMemo<SettingsContextValue>(() => {
    const networkConfigured = isAddress(settings.contractAddress);
    const scope = settings.mode === "local" ? "local" : `${settings.chainId}:${settings.contractAddress.toLowerCase() || "unset"}`;
    return { settings, scope, networkConfigured, setMode, saveNetworkSettings, resetToEnv };
  }, [settings, setMode, saveNetworkSettings, resetToEnv]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
