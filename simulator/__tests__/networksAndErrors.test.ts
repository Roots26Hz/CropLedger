import { Interface, makeError } from "ethers";
import { describe, expect, it } from "vitest";
import { CROPLEDGER_ABI } from "../abi.js";
import { LedgerRuleError, decodeError } from "../errors.js";
import { toBytes32Id } from "../ids.js";
import {
  addChainParameters,
  assertSupportedChain,
  chainLabel,
  explorerAddressUrl,
  explorerBlockUrl,
  explorerTxUrl,
  isRetiredRpcUrl,
  isSupportedChain,
  POLYGON_AMOY,
} from "../networks.js";

const TX = `0x${"ab".repeat(32)}`;

describe("network registry", () => {
  it("links Amoy transactions to the Amoy explorer, never to mainnet", () => {
    const url = explorerTxUrl(80002, TX)!;
    expect(url).toBe(`https://amoy.polygonscan.com/tx/${TX}`);
    expect(url.startsWith("https://polygonscan.com")).toBe(false);
    expect(explorerAddressUrl(80002n, "0xabc")).toBe("https://amoy.polygonscan.com/address/0xabc");
    expect(explorerBlockUrl(80002, 123n)).toBe("https://amoy.polygonscan.com/block/123");
  });

  it("has no explorer links for the local Hardhat chain", () => {
    expect(explorerTxUrl(31337, TX)).toBeUndefined();
  });

  it("refuses mainnets and unknown chains", () => {
    expect(isSupportedChain(80002)).toBe(true);
    expect(isSupportedChain(31337)).toBe(true);
    expect(isSupportedChain(137)).toBe(false);
    expect(isSupportedChain(1)).toBe(false);
    expect(() => assertSupportedChain(137)).toThrow(/Polygon PoS Mainnet.*not supported/);
    expect(chainLabel(424242)).toBe("Unknown chain 424242");
    expect(explorerTxUrl(137, TX)).toBeUndefined();
  });

  it("recognises the retired Amoy RPC endpoint", () => {
    expect(isRetiredRpcUrl(80002, "https://rpc-amoy.polygon.technology/")).toBe(true);
    expect(isRetiredRpcUrl(80002, POLYGON_AMOY.defaultRpcUrl)).toBe(false);
    expect(isRetiredRpcUrl(31337, "https://rpc-amoy.polygon.technology")).toBe(false);
  });

  it("builds wallet_addEthereumChain parameters", () => {
    expect(addChainParameters(POLYGON_AMOY)).toEqual({
      chainId: "0x13882",
      chainName: "Polygon Amoy Testnet",
      nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
      rpcUrls: ["https://polygon-amoy.drpc.org"],
      blockExplorerUrls: ["https://amoy.polygonscan.com"],
    });
  });
});

describe("error decoding", () => {
  const iface = new Interface(CROPLEDGER_ABI);
  const deviceId = toBytes32Id("CL-DEV-0001");

  it("decodes custom-error revert data", () => {
    const data = iface.encodeErrorResult("StaleNonce", [deviceId, 3n, 5n]);
    const decoded = decodeError({ code: "CALL_EXCEPTION", data });
    expect(decoded.kind).toBe("contract");
    expect(decoded.name).toBe("StaleNonce");
    expect(decoded.message).toContain("nonce 3");
    expect(decoded.message).toContain("CL-DEV-0001");
  });

  it("decodes revert data nested inside provider errors", () => {
    const data = iface.encodeErrorResult("UnknownDevice", [deviceId]);
    const decoded = decodeError({ info: { error: { code: 3, data } } });
    expect(decoded.name).toBe("UnknownDevice");
  });

  it("decodes local-ledger rule errors with the same names", () => {
    const decoded = decodeError(new LedgerRuleError("DeviceNotActive", [deviceId]));
    expect(decoded).toMatchObject({ kind: "contract", name: "DeviceNotActive" });
    expect(decoded.detail).toContain("Local demo ledger");
  });

  it("recognises wallet rejections", () => {
    expect(decodeError({ code: 4001, message: "User rejected the request." }).kind).toBe("wallet-rejected");
    expect(decodeError(makeError("user rejected action", "ACTION_REJECTED", { action: "sendTransaction", reason: "rejected" })).kind).toBe(
      "wallet-rejected",
    );
    expect(decodeError({ error: { code: -32002 } }).kind).toBe("wallet-pending");
  });

  it("recognises RPC failures", () => {
    expect(decodeError(makeError("could not detect network", "NETWORK_ERROR", { event: "noNetwork" })).kind).toBe("rpc");
    expect(decodeError(new TypeError("Failed to fetch")).kind).toBe("rpc");
  });
});
