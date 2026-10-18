import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

// Load server-side variables from .env when present (Node >= 20.12 built-in).
// Hardhat's configVariable() reads the encrypted keystore first and then
// process.env, and it is only resolved when a network that needs it is used,
// so tests and local development never require any secrets.
try {
  process.loadEnvFile();
} catch {
  // No .env file: fine for compile, test and local node workflows.
}

// Keep these settings identical to the Remix compiler settings documented in
// REMIX_DEPLOYMENT_GUIDE.md so bytecode and gas figures match.
const SOLC_VERSION = "0.8.34";
const SOLC_SETTINGS = {
  evmVersion: "cancun",
  optimizer: { enabled: true, runs: 200 },
};

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: { version: SOLC_VERSION, settings: SOLC_SETTINGS },
      production: { version: SOLC_VERSION, settings: SOLC_SETTINGS },
    },
  },
  networks: {
    // Simulated chain served by `npm run node` (hardhat node --network localNode).
    // Like a public RPC node, it mines reverting transactions with status 0
    // instead of rejecting them at send time, so the dashboard can show a
    // genuine "reverted on-chain" result. Calls (eth_call) still revert normally.
    localNode: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      throwOnTransactionFailures: false,
    },
    // `npm run node` JSON-RPC endpoint (chain ID 31337).
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    // Polygon Amoy public testnet (chain ID 80002). Optional: Remix is the
    // primary deployment path; this is the CLI alternative.
    amoy: {
      type: "http",
      chainType: "generic",
      chainId: 80002,
      url: configVariable("AMOY_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
});
