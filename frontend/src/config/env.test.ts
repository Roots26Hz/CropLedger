import { describe, expect, it } from "vitest";
import { maskRpcUrl, readEnvConfig } from "./env";

describe("readEnvConfig", () => {
  it("accepts a valid Amoy configuration", () => {
    const cfg = readEnvConfig({
      VITE_CHAIN_ID: "80002",
      VITE_CONTRACT_ADDRESS: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
      VITE_RPC_URL: "https://polygon-amoy.drpc.org",
      VITE_DEPLOY_BLOCK: "123",
    } as ImportMetaEnv);
    expect(cfg.issues).toEqual([]);
    expect(cfg.chainId).toBe(80002);
    expect(cfg.contractAddress).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    expect(cfg.deployBlock).toBe(123);
  });

  it("refuses mainnet chain IDs", () => {
    const cfg = readEnvConfig({ VITE_CHAIN_ID: "137" } as ImportMetaEnv);
    expect(cfg.chainId).toBeNull();
    expect(cfg.issues[0]).toMatch(/Polygon PoS Mainnet.*not supported/);
  });

  it("reports invalid values instead of using them", () => {
    const cfg = readEnvConfig({ VITE_CONTRACT_ADDRESS: "0x1234", VITE_RPC_URL: "ftp://x", VITE_DEPLOY_BLOCK: "-5" } as ImportMetaEnv);
    expect(cfg.contractAddress).toBeNull();
    expect(cfg.rpcUrl).toBeNull();
    expect(cfg.deployBlock).toBeNull();
    expect(cfg.issues).toHaveLength(3);
  });

  it("replaces the retired Amoy RPC endpoint and says so", () => {
    const cfg = readEnvConfig({ VITE_CHAIN_ID: "80002", VITE_RPC_URL: "https://rpc-amoy.polygon.technology" } as ImportMetaEnv);
    expect(cfg.rpcUrl).toBeNull();
    expect(cfg.issues[0]).toMatch(/shut down/);
  });

  it("treats empty values as unset (local demo mode)", () => {
    const cfg = readEnvConfig({ VITE_CHAIN_ID: "", VITE_CONTRACT_ADDRESS: "  " } as ImportMetaEnv);
    expect(cfg).toMatchObject({ chainId: null, contractAddress: null, issues: [] });
  });
});

describe("maskRpcUrl", () => {
  it("hides paths that may contain API keys", () => {
    expect(maskRpcUrl("https://polygon-amoy.g.alchemy.com/v2/SECRETKEY123")).toBe("https://polygon-amoy.g.alchemy.com/•••");
    expect(maskRpcUrl("https://rpc.example.com?apikey=SECRET")).toBe("https://rpc.example.com/•••");
    expect(maskRpcUrl("https://polygon-amoy.drpc.org")).toBe("https://polygon-amoy.drpc.org");
    expect(maskRpcUrl("not a url")).toBe("(invalid URL)");
  });
});
