import { parseUnits } from "ethers";
import { describe, expect, it } from "vitest";
import { suggestFees, type FeeProvider } from "../fees.js";
import { HARDHAT_LOCAL, POLYGON_AMOY } from "../networks.js";

const gwei = (n: number) => parseUnits(String(n), "gwei");

/** fetch stub returning a Polygon gas-station style body (or failing). */
function station(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, status: ok ? 200 : 503, json: async () => body })) as unknown as typeof fetch;
}
const failingFetch = (async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;

function provider(tipGwei: number | null, baseFeeWei: bigint | null = 63n): FeeProvider {
  return {
    getBlock: async () => ({ baseFeePerGas: baseFeeWei }),
    getFeeData: async () => ({ maxPriorityFeePerGas: tipGwei === null ? null : gwei(tipGwei) }),
  };
}

describe("suggestFees", () => {
  it("leaves fees to the wallet on networks without a fee policy", async () => {
    expect(await suggestFees(HARDHAT_LOCAL, { fetchImpl: failingFetch })).toBeUndefined();
  });

  it("never goes below Polygon's 25 gwei floor (plus a 20 % margin)", async () => {
    const fees = await suggestFees(POLYGON_AMOY, {
      fetchImpl: station({ standard: { maxPriorityFee: 25 }, estimatedBaseFee: 6.3e-8 }),
    });
    expect(fees?.maxPriorityFeePerGas).toBe(gwei(30));
    expect(fees?.maxFeePerGas).toBe(gwei(30) + 2n * 63n + gwei(1));
    expect(fees?.source).toBe("Polygon gas station");
  });

  it("uses a higher gas-station tip when the network is busier", async () => {
    const fees = await suggestFees(POLYGON_AMOY, { fetchImpl: station({ standard: { maxPriorityFee: 52.5 } }) });
    expect(fees?.maxPriorityFeePerGas).toBe(gwei(52.5));
  });

  it("falls back to the RPC's suggestion when the gas station is unavailable", async () => {
    const fees = await suggestFees(POLYGON_AMOY, { fetchImpl: station({}, false), provider: provider(139) });
    expect(fees?.maxPriorityFeePerGas).toBe(gwei(139));
    expect(fees?.source).toBe("RPC suggestion");
  });

  it("caps runaway suggestions to protect scarce test tokens", async () => {
    const fees = await suggestFees(POLYGON_AMOY, { fetchImpl: failingFetch, provider: provider(5000) });
    expect(fees?.maxPriorityFeePerGas).toBe(gwei(200));
  });

  it("still returns a valid floor fee when every source fails", async () => {
    const fees = await suggestFees(POLYGON_AMOY, { fetchImpl: failingFetch });
    expect(fees?.maxPriorityFeePerGas).toBe(gwei(30));
    expect(fees?.source).toBe("network minimum");
  });
});
