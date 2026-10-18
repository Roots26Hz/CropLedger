# CropLedger Demonstration Guide

Step-by-step scripts for the six required scenarios, in three setups. Pick the setup that matches what you have on demo day.

| Setup | Needs | Shows |
|---|---|---|
| **A. Polygon Amoy** (best for assessment) | MetaMask + test POL + your Remix deployment | Real public-testnet transactions and explorer links |
| **B. Local Hardhat chain** | Nothing external | Real EVM transactions, blocks and receipts on your laptop (no explorer) |
| **C. Local demonstration mode** | Nothing | Same rules, signatures and hashing in the browser; clearly labelled, no transactions |

## 0. Before the demo (10 minutes)

```bash
npm install          # once
npm test             # optional: 105 tests should pass
```

**Setup A** — follow [REMIX_DEPLOYMENT_GUIDE.md](../REMIX_DEPLOYMENT_GUIDE.md) §1–8 beforehand, then `npm run dev`, open <http://localhost:5173>, connect MetaMask (Amoy), System Configuration → *Run checks* (all green). Keep Remix open in a second tab with the deployed contract.

**Setup B** — three terminals:

```bash
npm run node                                   # terminal 1: local chain (keep running)
OWNER_ADDRESS=0xYourMetaMaskAddress npm run deploy:local   # terminal 2
npm run dev                                    # terminal 3
```

`deploy:local` makes your MetaMask address the owner and gives it 100 local test ETH. In MetaMask add a network *Hardhat Local*: RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol `ETH` (or press *Switch to Hardhat* in the dashboard). In System Configuration choose *Hardhat Local Node*, paste the printed address, Save, Run checks.

> MetaMask remembers nonces per network. If you restart `npm run node`, use MetaMask → Settings → Advanced → **Clear activity tab data** before sending again.

**Setup C** — `npm run dev`, open the app. With no contract configured it starts in local demonstration mode (amber banner).

**Reset between rehearsals:** System Configuration → *Reset local demo* (local mode), or restart the node and redeploy (Setup B).

---

## Scenario 1 — Successful reading

| # | Action | Expected result |
|---|---|---|
| 1 | Top bar → **Connect wallet** (A/B) | Account chip shows `0x…` and the network name; no red *Switch* button |
| 2 | Device Registry → ID `CL-DEV-0001`, field `FIELD-A1` → **Generate key & register** | MetaMask asks to confirm `registerDevice` (A/B). Row appears: *Active*, nonce 0, *key in this browser* |
| 3 | Live Sensor Feed → **One reading** | Row shows N/P/K, moisture, pH, edge-AI label, *signed* |
| 4 | **Submit** on that row (auto-submit is on by default in mode C) | Status goes *Preflight check → Awaiting wallet → Pending → Confirmed*, with block number (A: explorer *Tx* link) |
| 5 | Transactions page | Same operation, tx hash (A: `amoy.polygonscan.com/tx/…`), block, gas used |
| 6 | Evidence Explorer → device `CL-DEV-0001` → **Retrieve history** | The reading is listed with its payload hash and *stored* payload |
| 7 | **Inspect** → **Find transaction** (A/B) | Transaction hash, relayer address and gas used |
| 8 | Verification Lab → select the reading → **Verify original** | **VERIFIED — MATCHES THE LEDGER**; signature line ✓ |
| 9 | Network & Consensus | All seven lifecycle steps green, confirmations counting up (A/B) |

*To show continuous streaming:* choose an interval and press **Start**; inject a **Spike** — the next reading is flagged *anomaly* (red point on the charts) and is still recorded faithfully. In setup A/B each reading needs a MetaMask approval, so prefer **Burst × 5** then **Submit queued**.

## Scenario 2 — Tampered payload

| # | Action | Expected result |
|---|---|---|
| 1 | Verification Lab → *Payload integrity* → pick a recorded reading | Canonical payload and its keccak256 shown; *Identical to the stored hash* |
| 2 | **Verify original** | **VERIFIED** (from `verifyReading`, a read-only call) |
| 3 | In *Altered copy*, change **N** by a few units (e.g. 142 → 167) | Red badge `n: 142 → 167`; new hash with most characters highlighted as different; *signature no longer matches* |
| 4 | **Verify altered copy** | **TAMPERING DETECTED** — `verifyReading` returned `false` |
| 5 | Point at step 8 | Original verified, altered rejected; the altered payload was never submitted |

Remix variant: `verifyReading(deviceId, index, hash)` with the genuine and the tampered hash printed by `npm run sim -- remix-args` → `true` / `false`.

## Scenario 3 — Unregistered device

Verification Lab → *Attack scenarios* → **Unregistered device → Run**.
Expected: *Rejected by contract* · `UnknownDevice` · *blocked as expected* — "Device ROGUE-xxxx is not registered…". No gas is spent (preflight).
CLI variant: `npm run sim -- attack unregistered --device CL-DEV-0001 --network localhost`.

## Scenario 4 — Replay attack

Prerequisite: at least one confirmed reading from this browser.
Attack scenarios → **Replay attack → Run**.
Expected: `StaleNonce` — "Replay rejected: nonce N is not greater than the last accepted nonce N".
Also try **Gateway forgery → Run**: `InvalidSignature` (the gateway changed N after the device signed).

To record the failure **on-chain** (A/B): tick *Also broadcast rejected attempts*, run again and approve in MetaMask → status *Reverted on-chain*, a real transaction hash with status 0, and the decoded reason.

## Scenario 5 — Revoked device

Attack scenarios → **Revoked device → Run** (owner account; in A/B approve three MetaMask prompts: register, one reading, revoke).
Expected log:

```
1/4 Registering throw-away device REVOKE-DEMO-xxxx…
2/4 Recording one genuine reading…
3/4 Owner revokes the device…
4/4 The revoked device tries to submit another reading…
History check: 1 reading(s) still retrievable; verifyReading(#0) = true.
```

…followed by `DeviceNotActive` · *blocked as expected*. Device Registry shows the device as *Revoked* with 1 reading.

## Scenario 6 — Wallet and network errors

| Situation | How to show it | Expected |
|---|---|---|
| Wallet not installed | Open the app in a browser profile without MetaMask (or a private window with extensions disabled) | Top bar: *No wallet detected · Get MetaMask*; owner/submit buttons disabled with the reason on hover; local mode still fully usable |
| Wallet not connected | Account menu → **Disconnect**, then try *Submit* | Buttons disabled: "Connect your wallet (top-right) to send transactions." |
| Wrong network | Switch MetaMask to another network (e.g. Ethereum Sepolia) | Red **Switch to Amoy** button; account chip shows the wrong chain; writes blocked with an explanation |
| User rejects a transaction | Submit a reading and press **Reject** in MetaMask | Status *Rejected in wallet* (amber) — "You rejected the request in your wallet. Nothing was sent." |
| Missing contract address | System Configuration → Blockchain network with an empty address | Banner *No contract configured* with a **Configure** button; app does not crash |
| RPC failure | Set the RPC URL to `http://127.0.0.1:9` (or stop `npm run node` in setup B) | Red banner *Cannot read the blockchain* with **Retry**; diagnostics show *RPC endpoint ✕*; the app never silently switches to local mode |

---

## Timing plan for a 5-minute live demo

| Time | Show |
|---|---|
| 0:00–0:40 | Remix: contract source, compile tick, deployed instance (Setup A) |
| 0:40–1:30 | Device Registry: register a device (MetaMask prompt) |
| 1:30–2:30 | Live Feed: one reading → submit → *Confirmed*; open the Amoy explorer link |
| 2:30–3:30 | Verification Lab: verify original, change N, tampering detected |
| 3:30–4:30 | Attack scenarios: replay + unregistered (+ revoked if time) |
| 4:30–5:00 | Network & Consensus lifecycle; close with the limitation (integrity ≠ sensor accuracy) |

The full narration is in [ORAL_PRESENTATION_GUIDE.md](../ORAL_PRESENTATION_GUIDE.md).
