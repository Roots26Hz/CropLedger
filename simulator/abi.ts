/**
 * Contract ABI shared by the gateway, CLI and dashboard.
 *
 * abi/CropLedger.json is generated from the compiled contract by
 * `npm run export-abi` (or pasted from Remix's "ABI" copy button). The
 * contract test suite fails if it drifts from contracts/CropLedger.sol.
 */
import type { InterfaceAbi } from "ethers";
import abi from "../abi/CropLedger.json" with { type: "json" };

export const CROPLEDGER_ABI = abi as InterfaceAbi;
