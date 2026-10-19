/**
 * Give an address local test ETH on the Hardhat node, so MetaMask can deploy
 * CropLedger from Remix and send transactions without a faucet.
 *
 *   npm run node                                       # terminal 1 (keep running)
 *   npm run fund:local -- 0xYourMetaMaskAddress        # terminal 2: 100 ETH
 *   npm run fund:local -- 0xYourMetaMaskAddress 500    # a different amount
 *
 * The ETH comes from the node's first built-in development account, which the
 * node signs for itself, so no private key is read, needed or printed. Only
 * the local Hardhat chain (31337) is accepted, and the ETH disappears when
 * the node stops.
 */
import { JsonRpcProvider, formatEther, getAddress, isAddress, parseEther } from "ethers";
import { HARDHAT_LOCAL } from "../simulator/networks.js";

const [target, amount = "100"] = process.argv.slice(2);
if (!target || !isAddress(target)) {
  console.error("Usage: npm run fund:local -- 0xYourMetaMaskAddress [amount in ETH, default 100]");
  process.exit(1);
}
let value: bigint;
try {
  value = parseEther(amount);
} catch {
  console.error(`"${amount}" is not an ETH amount. Example: npm run fund:local -- ${target} 100`);
  process.exit(1);
}

const rpcUrl = HARDHAT_LOCAL.defaultRpcUrl;
const provider = new JsonRpcProvider(rpcUrl, HARDHAT_LOCAL.chainId, { staticNetwork: true, batchMaxCount: 1 });
try {
  let chainId: number;
  try {
    chainId = Number.parseInt((await provider.send("eth_chainId", [])) as string, 16);
  } catch {
    throw new Error(`No local node answers at ${rpcUrl}. Start it first with \`npm run node\` in another terminal.`);
  }
  if (chainId !== HARDHAT_LOCAL.chainId) {
    throw new Error(`${rpcUrl} reports chain ${chainId}, not the local Hardhat chain (${HARDHAT_LOCAL.chainId}). Nothing was sent.`);
  }
  const [source] = (await provider.send("eth_accounts", [])) as string[];
  if (!source) throw new Error("The node has no built-in development accounts to send from.");

  const to = getAddress(target);
  const tx = await (await provider.getSigner(source)).sendTransaction({ to, value });
  const receipt = await tx.wait();
  const balance = await provider.getBalance(to);

  console.log(`
Sent ${formatEther(value)} local test ETH to ${to}
(LOCAL Hardhat chain ${HARDHAT_LOCAL.chainId} only: no real value, not a public network)
  tx        ${tx.hash}
  block     ${receipt!.blockNumber}
  balance   ${formatEther(balance)} ETH

In MetaMask, select the Hardhat Local network (RPC ${rpcUrl}, chain ID ${HARDHAT_LOCAL.chainId}) to see it.
The ETH disappears when \`npm run node\` stops; run this command again after restarting the node.
`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  provider.destroy();
}
