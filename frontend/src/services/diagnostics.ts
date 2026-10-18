/**
 * Configuration diagnostics for network mode: checks the RPC endpoint, the
 * deployed contract, ABI/signing compatibility and the wallet, and explains
 * each failure. Read-only; never sends a transaction.
 */
import { Contract, JsonRpcProvider, formatEther, getAddress, isAddress } from "ethers";
import { CROPLEDGER_ABI } from "@core/abi.js";
import { decodeError } from "@core/errors.js";
import { chainLabel, getNetwork } from "@core/networks.js";
import { EIP712_NAME, EIP712_VERSION, READING_TYPEHASH } from "@core/signing.js";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface DiagnosticsInput {
  chainId: number;
  contractAddress: string;
  rpcUrl: string;
  wallet: { status: string; account: string | null; chainId: number | null };
}

export async function runDiagnostics(input: DiagnosticsInput): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => checks.push({ id, label, status, detail });
  const network = getNetwork(input.chainId);

  if (!network) {
    add("chain", "Supported network", "fail", `Chain ${input.chainId} is not allowed. Use Polygon Amoy (80002) or Hardhat (31337).`);
    return checks;
  }
  add("chain", "Supported network", "pass", `${network.name} (chain ID ${network.chainId}); mainnets are refused.`);

  // RPC reachability and chain ID.
  const provider = new JsonRpcProvider(input.rpcUrl, undefined, { staticNetwork: false, batchMaxCount: 1 });
  let rpcOk = false;
  try {
    const hex = (await Promise.race([
      provider.send("eth_chainId", []),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 8 s")), 8000)),
    ])) as string;
    const rpcChain = Number.parseInt(hex, 16);
    if (rpcChain === input.chainId) {
      rpcOk = true;
      add("rpc", "RPC endpoint", "pass", `Reachable and reports chain ${rpcChain}.`);
    } else {
      add("rpc", "RPC endpoint", "fail", `The RPC reports ${chainLabel(rpcChain)} (${rpcChain}), not ${network.name}.`);
    }
  } catch (error) {
    add(
      "rpc",
      "RPC endpoint",
      "fail",
      `${decodeError(error).message}${input.chainId === 31337 ? " Is `npm run node` running?" : ""}`,
    );
  } finally {
    provider.destroy();
  }

  // Contract checks.
  if (!isAddress(input.contractAddress)) {
    add("address", "Contract address", "fail", "Not a valid address. Copy it from Remix → Deployed Contracts.");
  } else if (!rpcOk) {
    add("address", "Contract address", "skip", "Skipped because the RPC endpoint is not usable.");
  } else {
    const address = getAddress(input.contractAddress);
    const reader = new JsonRpcProvider(input.rpcUrl, input.chainId, { staticNetwork: true, batchMaxCount: 1 });
    try {
      const code = await reader.getCode(address);
      if (code === "0x") {
        add("code", "Contract deployed", "fail", `No contract code at ${address} on ${network.name}. Wrong network or address?`);
      } else {
        add("code", "Contract deployed", "pass", `Bytecode found (${(code.length - 2) / 2} bytes).`);
        const contract = new Contract(address, CROPLEDGER_ABI, reader);
        try {
          const domain = (await contract.getFunction("eip712Domain")()) as { name: string; version: string; chainId: bigint; verifyingContract: string };
          const ok =
            domain.name === EIP712_NAME &&
            domain.version === EIP712_VERSION &&
            Number(domain.chainId) === input.chainId &&
            getAddress(domain.verifyingContract) === address;
          add(
            "domain",
            "EIP-712 domain",
            ok ? "pass" : "fail",
            ok ? `name "${domain.name}", version "${domain.version}" — matches the device signer.` : `Unexpected domain ${domain.name} v${domain.version}.`,
          );
          const typehash = (await contract.getFunction("READING_TYPEHASH")()) as string;
          add(
            "typehash",
            "ABI & signing format",
            typehash === READING_TYPEHASH ? "pass" : "fail",
            typehash === READING_TYPEHASH
              ? "READING_TYPEHASH matches the frontend's EIP-712 Reading type."
              : "READING_TYPEHASH differs: the deployed contract was built from different source. Update abi/CropLedger.json and signing code.",
          );
          const owner = (await contract.getFunction("owner")()) as string;
          const isOwner = input.wallet.account?.toLowerCase() === owner.toLowerCase();
          add("owner", "Contract owner", isOwner ? "pass" : "warn", isOwner ? `${owner} (your connected account).` : `${owner}. Connect this account to register or revoke devices.`);
        } catch (error) {
          add("abi", "ABI compatibility", "fail", `Calls failed — is this a CropLedger contract? ${decodeError(error).message}`);
        }
      }
    } catch (error) {
      add("code", "Contract deployed", "fail", decodeError(error).message);
    } finally {
      reader.destroy();
    }
  }

  // Wallet checks.
  if (input.wallet.status === "unavailable") {
    add("wallet", "Wallet", "warn", "MetaMask not detected. Reads work, but sending transactions needs a wallet.");
  } else if (input.wallet.status !== "connected") {
    add("wallet", "Wallet", "warn", "Wallet detected but not connected. Use “Connect wallet”.");
  } else if (input.wallet.chainId !== input.chainId) {
    add("wallet", "Wallet", "fail", `Wallet is on ${chainLabel(input.wallet.chainId ?? 0)}. Use “Switch to ${network.shortName}”.`);
  } else {
    add("wallet", "Wallet", "pass", `Connected to ${network.name}.`);
  }

  // Balance: gas estimation fails outright when the account cannot pay.
  if (input.wallet.account && rpcOk) {
    const reader = new JsonRpcProvider(input.rpcUrl, input.chainId, { staticNetwork: true, batchMaxCount: 1 });
    try {
      const balance = await reader.getBalance(input.wallet.account);
      // About one reading: ~135k gas at Polygon's ~32 gwei suggested fee cap.
      const perReading = 135_000n * 32_000_000_000n;
      const readings = balance / perReading;
      const amount = `${Number(formatEther(balance)).toLocaleString(undefined, { maximumSignificantDigits: 4 })} ${network.nativeCurrency.symbol}`;
      add(
        "balance",
        "Wallet balance",
        readings >= 5n ? "pass" : readings >= 1n ? "warn" : "fail",
        readings >= 1n
          ? `${amount} — enough for roughly ${readings.toString()} reading submissions.`
          : `${amount} — not enough to pay for a reading. Get test ${network.nativeCurrency.symbol} from a faucet.`,
      );
    } catch (error) {
      add("balance", "Wallet balance", "warn", decodeError(error).message);
    } finally {
      reader.destroy();
    }
  }
  return checks;
}
