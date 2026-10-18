/**
 * Copies the compiled CropLedger ABI from Hardhat's artifacts into
 * abi/CropLedger.json, which the simulator, gateway and frontend import.
 *
 *   npm run export-abi           # write abi/CropLedger.json
 *   npm run export-abi -- --check  # fail if the committed ABI is out of date
 *
 * If you change the contract in Remix instead, you can paste the ABI copied
 * from Remix's Solidity Compiler tab into abi/CropLedger.json; this script
 * and the test suite will tell you if it no longer matches the source.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = resolve(root, "artifacts/contracts/CropLedger.sol/CropLedger.json");
const abiPath = resolve(root, "abi/CropLedger.json");

if (!existsSync(artifactPath)) {
  console.error("Artifact not found. Run `npx hardhat build` first.");
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { abi: unknown[] };
const serialized = `${JSON.stringify(artifact.abi, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(abiPath) ? readFileSync(abiPath, "utf8") : "";
  if (current !== serialized) {
    console.error("abi/CropLedger.json is out of date. Run `npm run export-abi`.");
    process.exit(1);
  }
  console.log("abi/CropLedger.json matches the compiled contract.");
} else {
  mkdirSync(dirname(abiPath), { recursive: true });
  writeFileSync(abiPath, serialized);
  console.log(`Wrote ${artifact.abi.length} ABI entries to abi/CropLedger.json`);
}
