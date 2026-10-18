/**
 * CropLedger edge-device simulator and gateway CLI.
 *
 *   npm run sim -- help
 *
 * Device signing keys are generated locally and stored in
 * .simulator/devices.json (gitignored, file mode 600). They are simulated
 * device keys that never hold funds. Gas for Amoy submissions is paid by
 * GATEWAY_PRIVATE_KEY from .env (a testnet-only account you control).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Contract, JsonRpcProvider, Wallet, getAddress, type Signer } from "ethers";
import { ANOMALY_DESCRIPTIONS, EdgeDeviceSimulator, type AnomalyKind } from "./deviceSimulator.js";
import { decodeError } from "./errors.js";
import { Gateway, cropLedgerContract, type SubmissionUpdate } from "./gateway.js";
import { firmwareHashFor, fromBytes32Id, isValidId, toBytes32Id } from "./ids.js";
import { LocalLedger } from "./localLedger.js";
import { hashPayload, parsePayloadJson, prettyPayload } from "./payload.js";
import { HARDHAT_LOCAL, POLYGON_AMOY, assertSupportedChain, explorerTxUrl } from "./networks.js";
import { signedReadingFromJson, signedReadingToJson, type SignedReadingJson } from "./serialization.js";
import { LOCAL_DEMO_DOMAIN, signReading, toSubmitArgs } from "./signing.js";
import type { DeploymentDomain, ReadingPayload, SignedReading } from "./types.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = join(ROOT, ".simulator");
const DEVICES_FILE = join(STATE_DIR, "devices.json");

try {
  process.loadEnvFile(join(ROOT, ".env"));
} catch {
  // .env is optional.
}

// ----------------------------------------------------------------- storage

interface StoredDevice {
  deviceId: string;
  fieldId: string;
  firmware: string;
  address: string;
  privateKey: string;
  createdAt: string;
  /** Last nonce used per deployment ("chainId:contract"), for offline signing. */
  nonces: Record<string, number>;
}

interface DeviceStore {
  devices: Record<string, StoredDevice>;
}

function loadStore(): DeviceStore {
  if (!existsSync(DEVICES_FILE)) return { devices: {} };
  return JSON.parse(readFileSync(DEVICES_FILE, "utf8")) as DeviceStore;
}

function saveStore(store: DeviceStore): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(DEVICES_FILE, JSON.stringify(store, null, 2));
  chmodSync(DEVICES_FILE, 0o600);
}

function getDevice(id: string | undefined): StoredDevice {
  if (!id) fail("--device is required (see `npm run sim -- device:list`).");
  const device = loadStore().devices[id];
  if (!device) fail(`Unknown simulated device "${id}". Create it with: npm run sim -- device:create --id ${id} --field FIELD-A1`);
  return device;
}

function saveSigned(signed: SignedReading): string {
  const dir = join(STATE_DIR, "payloads", `${signed.domain.chainId}-${signed.domain.verifyingContract.toLowerCase()}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${signed.payload.deviceId}-nonce-${signed.payload.nonce}.json`);
  writeFileSync(file, JSON.stringify(signedReadingToJson(signed), null, 2));
  return file;
}

// --------------------------------------------------------------- networking

interface Connection {
  provider: JsonRpcProvider;
  contract: Contract;
  domain: DeploymentDomain;
  networkName: string;
  ownerSigner: () => Promise<Signer>;
  gatewaySigner: () => Promise<Signer>;
}

function resolveContractAddress(networkName: string, explicit?: string): string {
  if (explicit) return getAddress(explicit);
  if (networkName === "localhost") {
    const file = join(ROOT, "deployments", "localhost.json");
    if (existsSync(file)) return getAddress((JSON.parse(readFileSync(file, "utf8")) as { address: string }).address);
    fail("No local deployment found. Run `npm run node` and `npm run deploy:local`, or pass --contract.");
  }
  const fromEnv = process.env.CONTRACT_ADDRESS || process.env.VITE_CONTRACT_ADDRESS;
  if (fromEnv) return getAddress(fromEnv);
  fail("Pass --contract <address> or set VITE_CONTRACT_ADDRESS in .env.");
}

async function connect(networkName: string, contractAddress?: string): Promise<Connection> {
  const isLocal = networkName === "localhost";
  if (!isLocal && networkName !== "amoy") fail('--network must be "localhost" or "amoy".');
  const rpcUrl = isLocal ? HARDHAT_LOCAL.defaultRpcUrl : process.env.AMOY_RPC_URL || POLYGON_AMOY.defaultRpcUrl;
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  let chainId: bigint;
  try {
    chainId = (await provider.getNetwork()).chainId;
  } catch (error) {
    fail(`Cannot reach ${rpcUrl}: ${decodeError(error).message}${isLocal ? " Is `npm run node` running?" : ""}`);
  }
  assertSupportedChain(chainId);

  const address = resolveContractAddress(networkName, contractAddress);
  if ((await provider.getCode(address)) === "0x") fail(`No contract code at ${address} on ${networkName}.`);
  const contract = cropLedgerContract(address, provider);
  const domain = { chainId, verifyingContract: address };

  const envWallet = (name: string) => {
    const key = process.env[name];
    if (!key) fail(`${name} is not set in .env (testnet-only key). See .env.example.`);
    return new Wallet(key, provider);
  };

  return {
    provider,
    contract,
    domain,
    networkName,
    // On the local Hardhat node the accounts are unlocked: #0 deploys, #1 relays.
    ownerSigner: async () => {
      if (!isLocal) return envWallet("DEPLOYER_PRIVATE_KEY");
      const owner = (await contract.getFunction("owner")()) as string;
      const accounts = (await provider.send("eth_accounts", [])) as string[];
      if (!accounts.some((a) => a.toLowerCase() === owner.toLowerCase())) {
        fail(`The contract owner ${owner} is not an unlocked Hardhat account. Register the device from the dashboard (MetaMask) instead.`);
      }
      return provider.getSigner(owner);
    },
    gatewaySigner: async () => (isLocal ? provider.getSigner(1) : envWallet("GATEWAY_PRIVATE_KEY")),
  };
}

async function lastNonceOnChain(conn: Connection, deviceId: string): Promise<number | null> {
  try {
    const device = (await conn.contract.getFunction("getDevice")(toBytes32Id(deviceId))) as { lastNonce: bigint };
    return Number(device.lastNonce);
  } catch {
    return null; // not registered
  }
}

// ------------------------------------------------------------------ output

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function printUpdate(update: SubmissionUpdate, chainId: bigint): void {
  const time = new Date(update.at).toLocaleTimeString();
  const parts = [`  [${time}] ${update.stage}`];
  if (update.txHash) parts.push(`tx ${update.txHash}`);
  if (update.blockNumber !== undefined) parts.push(`block ${update.blockNumber}`);
  if (update.gasUsed !== undefined) parts.push(`gas ${update.gasUsed}`);
  console.log(parts.join("  "));
  if (update.error) console.log(`      → ${update.error.message}`);
  if (update.stage === "confirmed" && update.txHash) {
    const url = explorerTxUrl(chainId, update.txHash);
    if (url) console.log(`      explorer: ${url}`);
  }
}

function describeReading(p: ReadingPayload): string {
  return `nonce ${p.nonce}  N=${p.n} P=${p.p} K=${p.k} mg/kg  moisture=${(p.soilMoistureBp / 100).toFixed(2)}%  pH=${(p.phCenti / 100).toFixed(2)}  edge-AI=${p.anomalyLabel} (${(p.anomalyScoreMilli / 1000).toFixed(2)})`;
}

// ---------------------------------------------------------------- commands

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: "string" },
    field: { type: "string", default: "FIELD-A1" },
    firmware: { type: "string", default: "1.4.2" },
    device: { type: "string" },
    network: { type: "string", default: "localhost" },
    contract: { type: "string" },
    "chain-id": { type: "string", default: String(POLYGON_AMOY.chainId) },
    nonce: { type: "string" },
    count: { type: "string", default: "1" },
    interval: { type: "string", default: "5" },
    anomaly: { type: "string" },
    index: { type: "string" },
    payload: { type: "string" },
    "confirm-revoke": { type: "boolean", default: false },
    "force-broadcast": { type: "boolean", default: false },
  },
});

const [command = "help", subcommand] = positionals;

function parseAnomaly(): AnomalyKind | undefined {
  if (!opts.anomaly) return undefined;
  if (!(opts.anomaly in ANOMALY_DESCRIPTIONS)) fail(`--anomaly must be one of: ${Object.keys(ANOMALY_DESCRIPTIONS).join(", ")}`);
  return opts.anomaly as AnomalyKind;
}

function simulatorFor(device: StoredDevice, lastNonce: number): EdgeDeviceSimulator {
  return new EdgeDeviceSimulator(
    { deviceId: device.deviceId, fieldId: device.fieldId, firmware: device.firmware },
    { lastNonce },
  );
}

async function cmdDeviceCreate(): Promise<void> {
  const id = opts.id;
  if (!id || !isValidId(id)) fail("--id is required: 1-31 characters [A-Za-z0-9._:-], e.g. CL-DEV-0001");
  if (!isValidId(opts.field!)) fail("--field must be 1-31 characters [A-Za-z0-9._:-]");
  const store = loadStore();
  if (store.devices[id]) fail(`Device ${id} already exists in .simulator/devices.json`);
  const key = Wallet.createRandom();
  store.devices[id] = {
    deviceId: id,
    fieldId: opts.field!,
    firmware: opts.firmware!,
    address: key.address,
    privateKey: key.privateKey,
    createdAt: new Date().toISOString(),
    nonces: {},
  };
  saveStore(store);
  console.log(`\n✔ Created simulated device ${id} (key stored in .simulator/devices.json)\n`);
  printRegistration(store.devices[id]!);
}

function printRegistration(device: StoredDevice): void {
  console.log("registerDevice arguments (owner only — paste into Remix or use `npm run sim -- register`):");
  console.log(`  deviceId:     ${toBytes32Id(device.deviceId)}   ("${device.deviceId}")`);
  console.log(`  signer:       ${device.address}`);
  console.log(`  fieldId:      ${toBytes32Id(device.fieldId)}   ("${device.fieldId}")`);
  console.log(`  firmwareHash: ${firmwareHashFor(device.firmware)}   (firmware ${device.firmware})\n`);
}

function cmdDeviceList(): void {
  const devices = Object.values(loadStore().devices);
  if (devices.length === 0) {
    console.log("No simulated devices yet. Create one: npm run sim -- device:create --id CL-DEV-0001 --field FIELD-A1");
    return;
  }
  console.log("\nSimulated devices (.simulator/devices.json):");
  for (const d of devices) console.log(`  ${d.deviceId.padEnd(14)} field ${d.fieldId.padEnd(10)} fw ${d.firmware.padEnd(7)} signer ${d.address}`);
  console.log("");
}

/** Offline: generate, sign (local demo domain) and check against a LocalLedger. */
async function cmdGenerate(): Promise<void> {
  const device = getDevice(opts.device);
  const key = new Wallet(device.privateKey);
  const ledger = new LocalLedger();
  ledger.registerDevice(toBytes32Id(device.deviceId), device.address, toBytes32Id(device.fieldId), firmwareHashFor(device.firmware));
  const sim = simulatorFor(device, 0);
  const anomaly = parseAnomaly();
  console.log(`\nOffline dry run (LOCAL DEMO domain — nothing is sent to any blockchain)\n`);
  const count = Number(opts.count);
  for (let i = 0; i < count; i++) {
    // Inject after the edge model has a baseline (it needs a few readings).
    if (anomaly && i === Math.min(count - 1, Math.max(6, Math.floor(count / 2)))) sim.injectAnomaly(anomaly);
    const { payload, injected } = sim.generate();
    const signed = await signReading(key, LOCAL_DEMO_DOMAIN, payload);
    const { index } = ledger.submitReading(...toSubmitArgs(signed));
    console.log(`${describeReading(payload)}${injected ? `  [injected: ${injected}]` : ""}`);
    console.log(`  payloadHash ${signed.payloadHash}  signature ok  local index ${index}`);
  }
  console.log("");
}

async function cmdRegister(): Promise<void> {
  const device = getDevice(opts.device);
  const conn = await connect(opts.network!, opts.contract);
  const owner = await conn.ownerSigner();
  const contract = conn.contract.connect(owner) as Contract;
  console.log(`\nRegistering ${device.deviceId} on ${conn.networkName} (${conn.domain.verifyingContract})…`);
  try {
    const tx = await contract.getFunction("registerDevice")(
      toBytes32Id(device.deviceId),
      device.address,
      toBytes32Id(device.fieldId),
      firmwareHashFor(device.firmware),
    );
    console.log(`  submitted ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  confirmed in block ${receipt.blockNumber} (gas ${receipt.gasUsed})`);
    const url = explorerTxUrl(conn.domain.chainId, tx.hash);
    if (url) console.log(`  explorer: ${url}`);
  } catch (error) {
    fail(decodeError(error).message);
  }
}

async function cmdRun(): Promise<void> {
  const device = getDevice(opts.device);
  const conn = await connect(opts.network!, opts.contract);
  const lastNonce = await lastNonceOnChain(conn, device.deviceId);
  if (lastNonce === null) fail(`${device.deviceId} is not registered on this contract. Run: npm run sim -- register --device ${device.deviceId} --network ${conn.networkName}`);
  const gateway = new Gateway(cropLedgerContract(conn.domain.verifyingContract, await conn.gatewaySigner()), conn.domain);
  const key = new Wallet(device.privateKey);
  const sim = simulatorFor(device, lastNonce);
  const anomaly = parseAnomaly();
  const count = Number(opts.count);
  const intervalMs = Number(opts.interval) * 1000;

  console.log(`\nStreaming ${count} reading(s) from ${device.deviceId} to ${conn.networkName} every ${opts.interval}s`);
  for (let i = 0; i < count; i++) {
    if (anomaly && i === Math.min(count - 1, Math.max(6, Math.floor(count / 2)))) sim.injectAnomaly(anomaly);
    const { payload, injected } = sim.generate();
    const signed = await signReading(key, conn.domain, payload);
    const file = saveSigned(signed);
    console.log(`\n${describeReading(payload)}${injected ? `  [injected: ${injected}]` : ""}`);
    console.log(`  payloadHash ${signed.payloadHash}`);
    console.log(`  off-chain payload saved to ${file.replace(`${ROOT}/`, "")}`);
    await gateway.submit(signed, { onUpdate: (u) => printUpdate(u, conn.domain.chainId) });
    if (i < count - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.log("");
}

/** Print Remix-ready arguments for registerDevice and submitReading. */
async function cmdRemixArgs(): Promise<void> {
  const device = getDevice(opts.device);
  if (!opts.contract) fail("--contract <deployed address> is required (copy it from Remix → Deployed Contracts).");
  const chainId = BigInt(opts["chain-id"]!);
  assertSupportedChain(chainId);
  const domain = { chainId, verifyingContract: getAddress(opts.contract) };
  const store = loadStore();
  const key = `${chainId}:${domain.verifyingContract.toLowerCase()}`;
  const last = opts.nonce ? Number(opts.nonce) - 1 : (store.devices[device.deviceId]!.nonces[key] ?? 0);
  const sim = simulatorFor(device, last);
  const { payload } = sim.generate();
  const signed = await signReading(new Wallet(device.privateKey), domain, payload);
  store.devices[device.deviceId]!.nonces[key] = payload.nonce;
  saveStore(store);
  const file = saveSigned(signed);
  const [deviceId, r, nonce, signature] = toSubmitArgs(signed);
  const tampered = hashPayload({ ...payload, n: payload.n + 1 });

  console.log(`\nSigned for chain ${chainId}, contract ${domain.verifyingContract}\n`);
  printRegistration(device);
  console.log("submitReading arguments (any account may submit; paste each field into Remix):");
  console.log(`  deviceId:  ${deviceId}`);
  console.log(`  r:         [${r.timestamp}, ${r.n}, ${r.p}, ${r.k}, "${r.payloadHash}"]`);
  console.log(`  nonce:     ${nonce}`);
  console.log(`  signature: ${signature}\n`);
  console.log("Submit within 15 minutes of the reading timestamp is not required, but the timestamp");
  console.log("must not be more than 15 minutes ahead of the block time.\n");
  console.log("verifyReading after it is recorded (index = getReadingCount - 1):");
  console.log(`  genuine payloadHash  → true : ${signed.payloadHash}`);
  console.log(`  tampered (N + 1)     → false: ${tampered}\n`);
  console.log(`Canonical payload (saved to ${file.replace(`${ROOT}/`, "")}):\n${prettyPayload(payload)}\n`);
}

async function cmdAttack(): Promise<void> {
  const scenario = subcommand;
  if (!scenario || !["replay", "unregistered", "forged", "revoked"].includes(scenario)) {
    fail("Usage: npm run sim -- attack <replay|unregistered|forged|revoked> --device <id> [--network localhost|amoy]");
  }
  const device = getDevice(opts.device);
  const conn = await connect(opts.network!, opts.contract);
  const gatewaySigner = await conn.gatewaySigner();
  const gateway = new Gateway(cropLedgerContract(conn.domain.verifyingContract, gatewaySigner), conn.domain);
  const report = (u: SubmissionUpdate) => printUpdate(u, conn.domain.chainId);
  const lastNonce = (await lastNonceOnChain(conn, device.deviceId)) ?? 0;
  const key = new Wallet(device.privateKey);
  const sim = simulatorFor(device, lastNonce);

  console.log(`\nAttack scenario "${scenario}" against ${conn.networkName}\n`);
  if (scenario === "replay") {
    const signed = await signReading(key, conn.domain, sim.generate().payload);
    console.log("1) Submitting a genuine reading:");
    await gateway.submit(signed, { onUpdate: report });
    console.log("\n2) Re-submitting the exact same signed message (same nonce):");
    await gateway.submit(signed, { onUpdate: report, forceBroadcast: opts["force-broadcast"] });
  } else if (scenario === "unregistered") {
    const rogue = Wallet.createRandom();
    const rogueId = `ROGUE-${rogue.address.slice(2, 8).toUpperCase()}`;
    const rogueSim = new EdgeDeviceSimulator({ deviceId: rogueId, fieldId: device.fieldId, firmware: "6.6.6" });
    const signed = await signReading(rogue, conn.domain, rogueSim.generate().payload);
    console.log(`Submitting a reading signed by an unregistered device ${rogueId}:`);
    await gateway.submit(signed, { onUpdate: report, forceBroadcast: opts["force-broadcast"] });
  } else if (scenario === "forged") {
    const signed = await signReading(key, conn.domain, sim.generate().payload);
    const [id, r, nonce, signature] = toSubmitArgs(signed);
    console.log(`Gateway alters N from ${r.n} to ${r.n + 40} but keeps the device signature:`);
    try {
      await (conn.contract.connect(gatewaySigner) as Contract).getFunction("submitReading").staticCall(id, { ...r, n: r.n + 40 }, nonce, signature);
      console.log("  ✖ unexpectedly accepted");
    } catch (error) {
      console.log(`  rejected by contract: ${decodeError(error).message}`);
    }
  } else {
    if (!opts["confirm-revoke"]) fail(`Revocation is permanent. Re-run with --confirm-revoke to revoke ${device.deviceId}.`);
    const owner = await conn.ownerSigner();
    console.log(`1) Owner revokes ${device.deviceId}:`);
    const tx = await (conn.contract.connect(owner) as Contract).getFunction("revokeDevice")(toBytes32Id(device.deviceId));
    await tx.wait();
    console.log(`  revoked in tx ${tx.hash}`);
    console.log("\n2) The device tries to submit another reading:");
    const signed = await signReading(key, conn.domain, sim.generate().payload);
    await gateway.submit(signed, { onUpdate: report, forceBroadcast: opts["force-broadcast"] });
    const count = (await conn.contract.getFunction("getReadingCount")(toBytes32Id(device.deviceId))) as bigint;
    console.log(`\n3) Historical readings remain retrievable: getReadingCount = ${count}`);
  }
  console.log("");
}

async function cmdVerify(): Promise<void> {
  if (!opts.payload || opts.index === undefined) fail("Usage: npm run sim -- verify --payload <file.json> --index <n> [--network ...]");
  const text = readFileSync(resolve(opts.payload), "utf8");
  const parsed = JSON.parse(text) as SignedReadingJson | ReadingPayload;
  const payload = "kind" in parsed ? signedReadingFromJson(parsed).payload : parsePayloadJson(text);
  const conn = await connect(opts.network!, opts.contract);
  const hash = hashPayload(payload);
  const deviceId = toBytes32Id(payload.deviceId);
  try {
    const ok = (await conn.contract.getFunction("verifyReading")(deviceId, BigInt(opts.index), hash)) as boolean;
    console.log(`\nDevice ${fromBytes32Id(deviceId)} reading #${opts.index}`);
    console.log(`  recomputed payloadHash ${hash}`);
    console.log(ok ? "  ✔ VERIFIED — matches the on-chain record" : "  ✖ MISMATCH — this payload differs from what was recorded on-chain");
    console.log("");
  } catch (error) {
    fail(decodeError(error).message);
  }
}

function help(): void {
  console.log(`
CropLedger simulator & gateway CLI

  npm run sim -- device:create --id CL-DEV-0001 --field FIELD-A1 [--firmware 1.4.2]
  npm run sim -- device:list
  npm run sim -- generate --device CL-DEV-0001 [--count 5] [--anomaly spike|drift|dropout]
        Offline dry run with the local demo ledger (no blockchain).
  npm run sim -- register --device CL-DEV-0001 [--network localhost|amoy] [--contract 0x…]
  npm run sim -- run --device CL-DEV-0001 [--network localhost|amoy] [--count 10] [--interval 5] [--anomaly spike]
  npm run sim -- remix-args --device CL-DEV-0001 --contract 0x… [--chain-id 80002] [--nonce N]
        Print Remix-ready registerDevice / submitReading / verifyReading arguments.
  npm run sim -- attack <replay|unregistered|forged|revoked> --device CL-DEV-0001 [--network …]
        [--force-broadcast] [--confirm-revoke]
  npm run sim -- verify --payload .simulator/payloads/…json --index 0 [--network …]

Networks: localhost = npm run node + npm run deploy:local; amoy = Polygon Amoy (needs
GATEWAY_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY of TESTNET-ONLY accounts in .env).
`);
}

const commands: Record<string, () => void | Promise<void>> = {
  "device:create": cmdDeviceCreate,
  "device:list": cmdDeviceList,
  generate: cmdGenerate,
  register: cmdRegister,
  run: cmdRun,
  "remix-args": cmdRemixArgs,
  attack: cmdAttack,
  verify: cmdVerify,
  help,
};

const handler = commands[command];
if (!handler) {
  help();
  fail(`Unknown command "${command}"`);
}
await handler();
