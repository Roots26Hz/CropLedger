import { createContext, useContext } from "react";
import type { HashRoute } from "./useHashRoute";

export interface RouteContextValue {
  route: HashRoute;
  navigate: (path: string, params?: Record<string, string | number | undefined>) => void;
}

export const RouteContext = createContext<RouteContextValue | null>(null);

/** Current route and navigation helper for pages. */
export function useRoute(): RouteContextValue {
  const ctx = useContext(RouteContext);
  if (!ctx) throw new Error("useRoute must be used inside RouteContext");
  return ctx;
}
