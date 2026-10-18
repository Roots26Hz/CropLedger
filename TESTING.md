# Testing CropLedger

Results recorded on **18 October 2026** on macOS (Apple silicon), Node v24.16.0, npm 11.13.0. All numbers below come from actual runs; nothing is estimated.

## 1. Setup

```bash
npm install            # root + frontend workspace (one package-lock.json)
```

No `.env`, wallet, testnet RPC or deployed contract is needed: contract tests run on Hardhat's in-process EVM (EDR), unit tests run in Node.

## 2. Commands

| Command | What it runs |
|---|---|
| `npm test` | `test:contracts` then `test:unit` |
| `npm run test:contracts` | Hardhat 3 + Mocha + ethers: `test/*.test.ts` (compiles the contract first) |
| `npm run test:unit` | Vitest: `simulator/**/*.test.ts`, `frontend/src/**/*.test.ts` |
| `npm run typecheck` | `hardhat build`, `tsc` for root code, `tsc` for the frontend |
| `npm run lint` | ESLint 10 (typescript-eslint, React Hooks rules) |
| `npm run abi:check` | Fails if `abi/CropLedger.json` differs from the compiled contract |
| `npm run build` | Type-checks and builds the dashboard (Vite) |

## 3. Results

| Check | Result |
|---|---|
| Contract / gateway / parity tests (Hardhat) | **49 passing**, 0 failing |
| Unit tests (Vitest, 7 files) | **58 passed**, 0 failed |
| Type check (root + frontend) | pass |
| Lint | pass (0 problems) |
| ABI drift check | `abi/CropLedger.json matches the compiled contract.` |
| Frontend production build | pass (`vite build`, ~0.3 s) |
| Clean clone (`git clone` → `npm ci` → `abi:check` → `npm test` → typecheck → lint → build) | pass |
| GitHub Actions CI | **passed** — [run 39147522825](https://github.com/Roots26Hz/CropLedger/actions/runs/39147522825) (39 s); later pushes run the same workflow |

**Total automated tests: 107** (49 + 58).

### Gas used (measured on the Hardhat in-process network)

Printed by the contract test suite after each run:

| Operation | Gas used |
|---|---|
| `registerDevice` | 184 247 |
| `submitReading`, first reading of a device | 134 230 – 134 254 (varies by a few dozen gas with signature bytes) |
| `submitReading`, later readings | 100 030 – 100 054 |

Gas *units* are determined by the EVM and would be similar on Amoy; the cost in POL depends on the gas price at the time and was **not measured**, because no public testnet deployment has been made yet.

## 4. Test cases

### 4.1 Smart contract — `test/CropLedger.test.ts` (42)

Every signed reading in these tests is produced by the project's own TypeScript signer (`simulator/signing.ts`) and payload code (`simulator/payload.ts`), so the off-chain signing scheme is verified end to end against the Solidity implementation.

| Area | Tests |
|---|---|
| Deployment | sets owner · rejects zero owner · EIP-712 domain (name, version, chain ID, address) · `READING_TYPEHASH` equals the TypeScript constant · starts empty · committed ABI equals compiled ABI |
| Registration | registers + `DeviceRegistered` event + stored fields · enumeration + `DeviceIndexOutOfBounds` · duplicate device ID · signer already assigned · non-owner (`OwnableUnauthorizedAccount`) · zero device ID / signer / field / firmware · `getDevice` on unknown device |
| Revocation | revokes + `DeviceRevoked` + `revokedAt` · non-owner · unknown / already revoked · revoked ID can never be re-registered |
| Firmware | owner update + `FirmwareHashUpdated` · non-owner, zero hash, revoked device |
| Submission & retrieval | gateway relays a device-signed reading + `ReadingRecorded` with every argument · stored record fields incl. block number · reading count and `totalReadings` · sequential indices and separate per-device histories · JS EIP-712 digest equals `readingDigest()` · out-of-range `getReading` |
| Integrity | `verifyReading` true for the genuine payload, false after changing N, false after changing off-chain-only metadata · out-of-range `verifyReading` |
| Signatures | unregistered key · gateway alters N / payload hash / timestamp after signing · another device's ID · another field · another deployment and another chain ID · malformed signatures (empty, 64 bytes, zeros) |
| Unregistered / revoked | unregistered device (`UnknownDevice`) · revoked device rejected (`DeviceNotActive`) while history stays retrievable and verifiable |
| Replay | same message twice (even from another relayer) · older nonce after newer · nonce gaps allowed · zero nonce |
| Input validation | zero timestamp · far-future timestamp rejected, 60 s ahead accepted · nutrient above 10 000 · empty payload hash |
| Ownership | two-step transfer; new owner can register, old owner cannot |

### 4.2 Gateway integration — `test/gateway.test.ts` (6)

Simulated device + gateway against a deployed contract:
stages `validating → preflight → awaiting-wallet → submitted → confirmed` with tx hash, block and gas · replay stopped in preflight **without broadcasting** (sender nonce unchanged) · forced broadcast of a revoked device's reading is mined with status 0 and the reason `DeviceNotActive` is recovered · readings signed for another chain rejected before sending · payload edited after signing rejected · unsupported chains (e.g. 137) refused.

### 4.3 Local-mode parity — `test/parity.test.ts` (1 scenario, 19 checks)

Runs one scripted scenario (unregistered, register, duplicate, valid, replay, gap, stale, forged key, altered value, zero timestamp, nutrient overflow, zero hash, genuine/tampered/out-of-range verification, revoke, post-revocation submit, double revoke, history) against the real contract **and** the in-browser `LocalLedger`, and requires identical outcomes. This keeps local demonstration mode honest.

### 4.4 Unit tests (Vitest, 58)

| File | Covers |
|---|---|
| `simulator/__tests__/payload.test.ts` (18) | exact canonical serialization · key-order independence · stable hash · one-field change changes hash · JSON round trip · 12 invalid-payload cases · malformed JSON |
| `simulator/__tests__/signing.test.ts` (6) | type hash · sign + recover · message binds payload hash and IDs · altered message does not recover · domain separation (chain, contract) · submit-argument formatting |
| `simulator/__tests__/deviceSimulator.test.ts` (9) | realistic ranges · monotonic nonce · chain re-sync · reproducibility · normal readings stay normal · spike, dropout and drift detected by the edge model · loop start/stop |
| `simulator/__tests__/localLedger.test.ts` (4) | genuine reading · replay, unknown, forged, malformed, revoked · registry rules · snapshot/restore keeps replay protection |
| `simulator/__tests__/networksAndErrors.test.ts` (10) | Amoy links use `amoy.polygonscan.com` (never mainnet) · no links for Hardhat · mainnets refused · retired Amoy RPC recognised · `wallet_addEthereumChain` params · custom-error decoding (direct and nested) · local errors · wallet rejection codes · RPC failures |
| `frontend/src/config/env.test.ts` (6) | valid config · mainnet chain refused · invalid values reported · retired RPC replaced with a warning · empty = local mode · RPC URL masking |
| `frontend/src/services/ledger/localLedgerService.test.ts` (5) | simulated lifecycle with `LOCAL-…` reference and no tx hash · replay rejected in preflight · gateway forgery · real-deployment signature rejected · history after revocation |

## 5. Manual end-to-end checks performed

| Check | How | Observed |
|---|---|---|
| CLI on a live local chain | `npm run node`, `npm run deploy:local`, `npm run sim -- register / run / attack replay / attack unregistered / attack forged / attack revoked --confirm-revoke / verify / remix-args` | Readings confirmed in blocks with tx hashes; replay → `StaleNonce`, unregistered → `UnknownDevice`, forged → `InvalidSignature`, revoked → `DeviceNotActive` with history kept; genuine payload *VERIFIED*, payload with N + 5 *MISMATCH* |
| Dashboard, local demo mode | In-app browser: register device, bursts, spike injection, Verification Lab, all four attacks, Evidence Explorer, Transactions | All behaved as expected (see screenshot `docs/screenshots/local-demo-mode.png`) |
| Dashboard, network mode (Hardhat) | Dashboard against `npm run node` with a **test-only EIP-1193 shim** that forwards wallet requests to the node's unlocked account (exercises the same BrowserProvider → `eth_sendTransaction` path as MetaMask; the shim is not part of the app) | Registration, 5 readings confirmed in blocks, verification true/false, attacks rejected; with *broadcast* enabled, attacks mined with status 0 and decoded reasons; lifecycle and recent blocks shown from real chain data |
| Wallet-not-installed path | Dashboard with no injected wallet | "No wallet detected" badge; owner and submit actions disabled with reasons |

Bugs found and fixed through these checks (see the git history): device auto-selection before ledger load and ID/key conflicts, late-injected wallets (EIP-6963 discovery added), missing revert reasons for mined failures, a race that skipped auto-submitted readings, and lifecycle wording for rejected operations.

## 6. Known limitations

- **No automated MetaMask UI tests.** The wallet path was exercised with an EIP-1193 shim against a local node; the real MetaMask popups (connect, switch network, approve/reject) must be checked manually — see [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md), scenario 6.
- **No public testnet run yet.** Amoy deployment, confirmation latency, explorer pages and POL costs are untested until you complete [REMIX_DEPLOYMENT_GUIDE.md](REMIX_DEPLOYMENT_GUIDE.md).
- **No Solidity coverage report** is published (Hardhat supports `npx hardhat test --coverage` if needed).
- **No browser E2E suite in CI.** Frontend logic is unit-tested; full UI flows were verified manually as listed above.
- Timing-dependent behaviour (public RPC rate limits, reorgs) is not simulated.
