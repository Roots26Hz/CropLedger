/**
 * OPTIONAL command-line deployment to Polygon Amoy (chain ID 80002).
 *
 * The primary, assessed deployment path is Remix IDE + MetaMask
 * (see REMIX_DEPLOYMENT_GUIDE.md). Use this script only if you prefer the CLI.
 *
 * Requirements (never commit these):
 *   npx hardhat keystore set AMOY_RPC_URL          # or AMOY_RPC_URL in .env
 *   npx hardhat keystore set DEPLOYER_PRIVATE_KEY  # or DEPLOYER_PRIVATE_KEY in .env
 * The deployer must be a TESTNET-ONLY account funded with Amoy POL from a faucet.
 *
 *   npm run deploy:amoy
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { formatEther, getAddress } from "ethers";
import { network } from "hardhat";
import { POLYGON_AMOY, explorerAddressUrl, explorerTxUrl } from "../simulator/networks.js";

const { ethers } = await network.create("amoy");
const { chainId } = await ethers.provider.getNetwork();
if (chainId !== BigInt(POLYGON_AMOY.chainId)) {
  throw new Error(`Refusing to deploy: RPC reports chain ${chainId}, expected Polygon Amoy (80002).`);
}

const [deployer] = await ethers.getSigners();
const balance = await ethers.provider.getBalance(deployer!.address);
console.log(`Deployer ${deployer!.address} balance: ${formatEther(balance)} POL (Amoy test tokens)`);
if (balance === 0n) {
  throw new Error(`The deployer has no Amoy POL. Request test tokens at ${POLYGON_AMOY.faucets[0]} and retry.`);
}

const owner = process.env.OWNER_ADDRESS ? getAddress(process.env.OWNER_ADDRESS) : deployer!.address;
console.log(`Deploying CropLedger to Polygon Amoy with owner ${owner}…`);
const ledger = await ethers.deployContract("CropLedger", [owner]);
const deployTx = ledger.deploymentTransaction()!;
console.log(`  submitted: ${deployTx.hash}`);
console.log(`  ${explorerTxUrl(chainId, deployTx.hash)}`);
console.log("  waiting for confirmation…");
const receipt = await deployTx.wait(2);
const address = await ledger.getAddress();

mkdirSync("deployments", { recursive: true });
writeFileSync(
  "deployments/amoy.json",
  `${JSON.stringify(
    {
      network: "amoy",
      chainId: Number(chainId),
      address,
      owner,
      deployer: deployer!.address,
      blockNumber: receipt!.blockNumber,
      txHash: receipt!.hash,
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`
CropLedger deployed to Polygon Amoy (confirmed in block ${receipt!.blockNumber})
  address   ${address}
  contract  ${explorerAddressUrl(chainId, address)}

Add to .env and restart the dashboard:
  VITE_CHAIN_ID=80002
  VITE_CONTRACT_ADDRESS=${address}
  VITE_DEPLOY_BLOCK=${receipt!.blockNumber}
`);
