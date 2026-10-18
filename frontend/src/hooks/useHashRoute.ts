import { useCallback, useEffect, useState } from "react";

export interface HashRoute {
  path: string;
  params: URLSearchParams;
}

function parse(hash: string): HashRoute {
  const raw = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  return { path: path || "overview", params: new URLSearchParams(query) };
}

/**
 * Minimal hash router (#/page?param=value). Hash routing works on any static
 * host and with `vite preview` without server rewrites.
 */
export function useHashRoute() {
  const [route, setRoute] = useState<HashRoute>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((path: string, params?: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    const query = search.toString();
    window.location.hash = `/${path}${query ? `?${query}` : ""}`;
  }, []);

  return { route, navigate };
}
