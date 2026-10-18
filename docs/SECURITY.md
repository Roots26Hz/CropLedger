# CropLedger Security Notes

CropLedger is an educational case study built with production-conscious practices. This document states what it protects, what it does not, and how secrets are handled.

## 1. What the system guarantees — and what it does not

**Guaranteed (by the contract and cryptography):**

- **Integrity:** once recorded, a reading's values and payload hash cannot be changed or deleted. Any edit to the off-chain payload changes its keccak256 hash, and `verifyReading` returns `false`.
- **Attribution:** every accepted reading carries a valid EIP-712 signature from the key registered for that device, for this chain and this contract.
- **Uniqueness:** each device nonce is accepted at most once (no double-counting or replay).
- **Controlled membership:** only devices registered by the owner can write, and revoked devices cannot write again.

**Not guaranteed:**

- **Sensor accuracy.** The ledger proves *what a device reported*, not that the soil really had those values. A miscalibrated, damaged or manipulated physical sensor will still produce correctly signed readings. CropLedger protects the integrity and attribution of recorded readings, not physical truth.
- **Key secrecy on the device.** If a device's signing key is extracted, an attacker can sign readings as that device until the owner revokes it.
- **Honesty of the owner.** The owner decides which devices are trusted (see §3).
- **Off-chain payload availability.** The chain stores only a hash; whoever holds the full payload must keep it. A lost payload can no longer be shown, but a forged one can never be passed off as the original.
- **Timestamps** are device-reported. The contract only rejects zero and far-future values; the block number stored with each reading gives an independent upper bound on when it was recorded.

## 2. Threat model

| Threat | Mitigation | Where enforced | Tested by |
|---|---|---|---|
| Records edited after a dispute | Immutable storage; `verifyReading` compares the recomputed payload hash | Contract | `payload integrity verification` |
| Fake / unknown device | Registry; `UnknownDevice` | Contract | `rejects readings from an unregistered device` |
| Forged signature or wrong key | `ECDSA.tryRecover` must return the registered signer; malformed and high-s signatures rejected | Contract (OpenZeppelin) | `signature checks` suite |
| Gateway alters values in transit | Signature covers every value and the payload hash | Contract | `rejects values altered by the gateway after signing` |
| Replay of a valid message | Per-device nonce must strictly increase (`StaleNonce`) | Contract | `replay protection` suite |
| Replay on another chain / contract | EIP-712 domain includes chain ID and verifying contract | Contract | `rejects signatures made for another deployment or chain` |
| Reuse of a signature for another device or field | `deviceId` signed; `fieldId` taken from the registry | Contract | cross-device and cross-field tests |
| Compromised device key | `revokeDevice`; IDs and signer addresses cannot be reused | Contract | `device revocation` suite |
| Unauthorised registry changes | `onlyOwner`; two-step ownership transfer (`Ownable2Step`) | Contract | access-control tests |
| Garbage or extreme input | Zero-value checks, nutrient bound, future-timestamp bound | Contract | `reading input validation` suite |
| Accidental mainnet transaction | Chain allow-list (80002, 31337) in gateway, env parsing and wallet guard | Off-chain | `networks.test.ts`, `env.test.ts` |
| Misleading demo data | Local mode is bannered, uses `LOCAL-…` references, no hashes or explorer links, chain ID 0 signing domain | Frontend | `localLedgerService.test.ts` |

Security-sensitive checks live in the contract. The gateway's and frontend's checks only improve user experience (early, readable errors); the parity test proves the local demo ledger mirrors the contract.

## 3. Trust assumptions

- **Owner:** registers devices honestly, protects its key, revokes compromised devices promptly. The owner can register a device whose key it controls and then sign readings itself; this is visible on-chain because registrations emit public `DeviceRegistered` events. In production the owner should be a multisig or a governance contract shared by farmers, insurers and regulators.
- **RPC endpoint:** the dashboard trusts its RPC for reads. A malicious RPC could lie in what it displays (not change on-chain state). Run your own node or cross-check on an explorer for disputes.
- **Gateway:** untrusted by design. It can delay or drop readings (a dropped nonce simply leaves a gap) but cannot alter or forge them.
- **Renouncing ownership** (`renounceOwnership`, inherited) would freeze the registry permanently; don't call it.

## 4. Secret handling

| Secret | Where it lives | Never |
|---|---|---|
| Your wallet key / seed phrase | MetaMask only | requested, stored or displayed by the app |
| Deployer / gateway keys (optional, CLI only) | Encrypted Hardhat keystore (`npx hardhat keystore set …`) or the gitignored `.env` | in `VITE_*` variables, source code or commits |
| Simulated device keys | Browser `localStorage` (dashboard) or `.simulator/devices.json` (CLI, file mode 600, gitignored) | displayed in the UI; they are test keys with no funds |
| RPC API keys | Server-side `AMOY_RPC_URL` | in `VITE_RPC_URL` unless the key is public or domain-restricted (the UI masks the URL path anyway) |

Repository protections: `.gitignore` excludes `.env*` (except `.env.example`), `.simulator/`, `deployments/`, keystores, `*.pem`/`*.key`, build outputs and Hardhat artefacts. `.env.example` contains placeholders only. CI needs no secrets.

Adding a file to `.gitignore` does not remove it from history: if a secret is ever committed, rotate it immediately and rewrite history (for example with `git filter-repo`) before pushing.

## 5. Known limitations and recommended hardening

- Simulated device keys in `localStorage` are acceptable for a demo only. Real devices should keep keys in a secure element (e.g. ATECC608 on an ESP32 board) and attest their firmware.
- One transaction per reading is simple but costly at scale; Merkle-batched submission is the planned improvement.
- `getReadings` in the dashboard reads up to the last 200 readings per device through view calls; very large histories should use an indexer (e.g. The Graph) over `ReadingRecorded` events.
- The contract is not upgradeable (deliberately: evidence rules cannot change under the parties' feet). A new version means a new deployment.
- No formal audit has been performed.
