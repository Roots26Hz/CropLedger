/**
 * Deploy CropLedger to a local Hardhat node (chain ID 31337).
 *
 *   npm run node            # terminal 1: start the local JSON-RPC node
 *   npm run deploy:local    # terminal 2: deploy
 *
 * Optional: set OWNER_ADDRESS in .env to your MetaMask address. The contract
 * is then owned by MetaMask (so you can register devices from the dashboard)
 * and that address is funded with local test ETH. This is a local chain only:
 * nothing here touches a public network or real funds.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getAddress, parseEther } from "ethers";
import { network } from "hardhat";

const { ethers } = await network.create("localhost");
const { chainId } = await ethers.provider.getNetwork();
if (chainId !== 31337n) throw new Error(`Expected the local Hardhat chain (31337), got ${chainId}`);

const [deployer] = await ethers.getSigners();
const owner = process.env.OWNER_ADDRESS ? getAddress(process.env.OWNER_ADDRESS) : deployer!.address;

console.log(`Deploying CropLedger to the local Hardhat node with owner ${owner}…`);
const ledger = await ethers.deployContract("CropLedger", [owner]);
await ledger.waitForDeployment();
const address = await ledger.getAddress();
const receipt = await ledger.deploymentTransaction()!.wait();

if (owner !== deployer!.address) {
  const fund = await deployer!.sendTransaction({ to: owner, value: parseEther("100") });
  await fund.wait();
  console.log(`Funded ${owner} with 100 local test ETH (local chain only).`);
}

const record = {
  network: "localhost",
  chainId: Number(chainId),
  address,
  owner,
  deployer: deployer!.address,
  blockNumber: receipt!.blockNumber,
  txHash: receipt!.hash,
  deployedAt: new Date().toISOString(),
};
mkdirSync("deployments", { recursive: true });
writeFileSync("deployments/localhost.json", `${JSON.stringify(record, null, 2)}\n`);

console.log(`
CropLedger deployed (LOCAL Hardhat chain — not a public network)
  address      ${address}
  owner        ${owner}
  block        ${receipt!.blockNumber}
  tx           ${receipt!.hash}

Saved to deployments/localhost.json (gitignored).

To use it in the dashboard, either paste the address in System Configuration
(network: Hardhat Local) or put these in .env and restart \`npm run dev\`:
  VITE_CHAIN_ID=31337
  VITE_CONTRACT_ADDRESS=${address}
  VITE_RPC_URL=http://127.0.0.1:8545
  VITE_DEPLOY_BLOCK=${receipt!.blockNumber}
`);
