# Remix Deployment Guide — CropLedger on Polygon Amoy

This guide is the exact workflow for showing the CropLedger smart contract in **Remix IDE**, deploying it to the **Polygon Amoy testnet** with **MetaMask**, connecting the dashboard to it, and demonstrating registration, a signed reading, verification and tamper rejection.

The Solidity source is shown **only in Remix**. The dashboard never displays Solidity code; it talks to the deployed contract through its ABI and address.

> **Status of this repository:** the contract has been tested on a local Hardhat chain. **No public Amoy deployment has been made by the authors yet.** Once you complete this guide you will have your own deployment; record its address and transaction hash in your report.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Open the contract in Remix](#2-open-the-contract-in-remix)
3. [Compile](#3-compile)
4. [Prepare MetaMask for Polygon Amoy](#4-prepare-metamask-for-polygon-amoy)
5. [Connect Remix to MetaMask](#5-connect-remix-to-metamask)
6. [Deploy to Amoy](#6-deploy-to-amoy)
7. [Check the deployment on the block explorer](#7-check-the-deployment-on-the-block-explorer)
8. [Connect the dashboard (address + ABI)](#8-connect-the-dashboard-address--abi)
9. [Register a device](#9-register-a-device)
10. [Submit a signed reading](#10-submit-a-signed-reading)
11. [Inspect the event and the transaction](#11-inspect-the-event-and-the-transaction)
12. [Verify the reading](#12-verify-the-reading)
13. [Show that tampering and replays are rejected](#13-show-that-tampering-and-replays-are-rejected)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. What you need

| Item | Notes |
|---|---|
| Browser with **MetaMask** | Chrome, Brave, Edge or Firefox with the MetaMask extension. Use a **testnet-only account**; never use an account that holds real funds. |
| **Amoy test POL** | Gas on Amoy is paid in test POL (no real value). See [step 4.3](#43-get-test-pol) for faucets; about 0.1 POL is enough for this whole guide. |
| This repository | `git clone https://github.com/Roots26Hz/CropLedger.git`, then `npm install` (see [README](README.md#installation)). Needed for the dashboard and for generating device signatures. |
| [Remix IDE](https://remix.ethereum.org/) | Web version, nothing to install. |

**Never** paste a private key or seed phrase into Remix, the dashboard, a `.env` that will be committed, or a chat. MetaMask signs everything.

---

## 2. Open the contract in Remix

The source file is [`contracts/CropLedger.sol`](contracts/CropLedger.sol). Use **one** of these methods.

### Method A — upload the file (recommended, works offline from GitHub)

1. Go to <https://remix.ethereum.org/>.
2. In **File Explorer** (first icon in the left bar), open the workspace menu and create a new workspace: template **Blank**, name `CropLedger`.
3. Right-click the workspace root → **New Folder** → `contracts`.
4. Right-click `contracts` → **Upload files** (or the upload icon) → choose `contracts/CropLedger.sol` from your clone.
   *(Alternatively create `contracts/CropLedger.sol` in Remix and paste the file's contents.)*

### Method B — load it straight from GitHub

Open this URL; Remix fetches the file into a temporary `code-sample` workspace:

```
https://remix.ethereum.org/#url=https://github.com/Roots26Hz/CropLedger/blob/main/contracts/CropLedger.sol
```

Temporary workspaces are not kept after a reload, so rename/copy it into a normal workspace if you want to keep it.

### About the OpenZeppelin imports

The contract imports OpenZeppelin (`Ownable2Step`, `EIP712`, `ECDSA`). Remix resolves `@openzeppelin/contracts/...` imports automatically from npm and stores them under `.deps/npm/@openzeppelin/contracts@<version>/`. The project is built and tested with **OpenZeppelin Contracts 5.6.1**; check the version folder Remix created. If Remix pulls a newer 5.x release the contract still compiles with the settings below.

**Fallback — single flattened file (pins OpenZeppelin 5.6.1 exactly):**

```bash
npm run flatten
```

This writes `CropLedger.flat.sol` (gitignored) with all imports inlined. Upload that file instead of `CropLedger.sol`.

---

## 3. Compile

1. Open the **Solidity Compiler** tab (second icon).
2. **Compiler:** `0.8.34` (any `0.8.24` or newer works; 0.8.34 matches the Hardhat build and its gas figures).
3. Expand **Advanced Configurations**:
   - **EVM version:** `cancun`
   - **Optimization:** enabled, **200** runs
4. Select `CropLedger.sol` in the editor and click **Compile CropLedger.sol**.
5. A green tick appears on the compiler icon. Under the button you now have:
   - **ABI** — copy button (used in [step 8](#8-connect-the-dashboard-address--abi) if you changed the contract),
   - **Bytecode**, and **Compilation Details** (shows the functions, events and custom errors).

*What to point out while the source is on screen:* the `Device` and `ReadingRecord` structs, `READING_TYPEHASH`, the checks at the top of `submitReading` (registered → active → nonce → input validation → signature), the custom errors, and the `ReadingRecorded` event.

---

## 4. Prepare MetaMask for Polygon Amoy

> **Important (July 2026 change):** Polygon shut down the old public RPC `https://rpc-amoy.polygon.technology` — the name no longer resolves. If you typed it into MetaMask, MetaMask cannot read the chain ID and refuses to save the network. Use **`https://polygon-amoy.drpc.org`** (the endpoint in Polygon's current docs) or one of the alternatives in step 4.2.

There are two parts: **4.1 add the network** and **4.3 get test POL**. You only need *one* of the methods in 4.1.

### 4.1 Method A — one click from the dashboard (easiest)

1. In the project folder run `npm run dev` and open <http://localhost:5173> in the browser that has MetaMask.
2. Open **System Configuration** (left sidebar, last item). You do **not** need a contract address or to change the operating mode for this step.
3. Make sure **Network** shows *Polygon Amoy Testnet (80002)*.
4. In the **MetaMask network** row, click **Add / switch to Amoy**.
5. MetaMask opens:
   - If asked to **connect**, choose your testnet account → *Connect*.
   - If asked to **add a network**, check: name *Polygon Amoy Testnet*, chain ID *80002*, currency *POL*, RPC *https://polygon-amoy.drpc.org* → **Approve**.
   - If asked to **switch network** → **Switch network**.
6. The row now says *Connected to Polygon Amoy Testnet*, and MetaMask shows **Polygon Amoy** with a balance of *0 POL*.

If nothing happens: MetaMask may already have a popup waiting — click the MetaMask (fox) icon in the browser toolbar to see it.

### 4.2 Method B — add it manually in MetaMask

MetaMask's labels change between versions; the path is roughly:

1. Click the **network selector** (top-left of the MetaMask window, it shows the current network name).
2. Click **Add a custom network** (older versions: *Add network* → *Add a network manually* at the bottom of the page).
3. Fill in exactly:

| Field | Value |
|---|---|
| Network name | `Polygon Amoy Testnet` |
| Default RPC URL | `https://polygon-amoy.drpc.org` (click *Add RPC URL* if the field is a drop-down) |
| Chain ID | `80002` |
| Currency symbol | `POL` |
| Block explorer URL | `https://amoy.polygonscan.com` |

4. Click **Save**, then select **Polygon Amoy Testnet** in the network selector. (In newer MetaMask versions you may need to enable *Show test networks* in the network list.)

**If MetaMask complains while saving:**

| Message | Meaning / fix |
|---|---|
| *Could not fetch chain ID. Is your RPC URL correct?* | The RPC is unreachable — usually the retired `rpc-amoy.polygon.technology`. Use `https://polygon-amoy.drpc.org`, or `https://polygon-amoy-bor-rpc.publicnode.com`, or `https://polygon-amoy.gateway.tenderly.co`. |
| *The chain ID returned by the RPC does not match* | You typed the wrong chain ID or an RPC for another network. Amoy is `80002` (hex `0x13882`). |
| A warning that the currency symbol does not match | Safe to continue with `POL` (Polygon renamed MATIC to POL). |
| *This Chain ID is currently used by …* / network already exists | Amoy is already in MetaMask (perhaps with the dead RPC). Open it via *Settings → Networks* (or the network's ⋮ menu → *Edit*) and replace its RPC URL with `https://polygon-amoy.drpc.org`. |

You can check an RPC yourself from a terminal; a working one answers `"result":"0x13882"`:

```bash
curl -s -X POST -H "content-type: application/json" --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' https://polygon-amoy.drpc.org
```

### 4.3 Get test POL

1. In MetaMask, with **Polygon Amoy** selected, copy your account address (click the account name/address at the top).
2. Open a faucet, paste the address and request Amoy POL. Faucets change their rules often; try them in this order:
   - Official: <https://faucet.polygon.technology/> (choose *Polygon PoS (Amoy)*; may ask you to sign in or may be temporarily unavailable).
   - Alchemy: <https://www.alchemy.com/faucets/polygon-amoy> (free account; at the time of writing it requires a small balance of real ETH on Ethereum mainnet).
   - QuickNode: <https://faucet.quicknode.com/polygon/amoy> (wallet connection; limited drips per day).
3. Wait 1–2 minutes. The balance appears in MetaMask, and you can confirm it at `https://amoy.polygonscan.com/address/<your address>`.

About **0.1 POL** is plenty for deploying the contract and running the whole demo. If every faucet refuses, ask your instructor or a classmate to send you a little Amoy POL (it has no real value) — or continue rehearsing with the local Hardhat chain ([docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md), setup B) until you have tokens.

**Done when:** MetaMask shows *Polygon Amoy Testnet* and a POL balance above 0.

---

## 5. Connect Remix to MetaMask

1. Open the **Deploy & Run Transactions** tab (fourth icon).
2. **Environment:** choose **Injected Provider – MetaMask** (in some Remix versions listed under *Browser Extension*).
3. MetaMask asks to connect the site → approve your testnet account.
4. Remix now shows `Custom (80002) network` (or *Polygon Amoy*) under Environment, and your account with its POL balance under **Account**. If it shows another chain, switch MetaMask to Amoy.

---

## 6. Deploy to Amoy

1. **Contract:** `CropLedger - contracts/CropLedger.sol`.
2. Next to **Deploy**, fill the constructor argument **`initialOwner`** with the address that should manage the device registry — normally **your own MetaMask address** (copy it with the copy icon next to *Account*).
3. Click **Deploy** → MetaMask shows the contract-creation transaction and fee → **Confirm**.
4. Wait for the Remix terminal to show the transaction as mined (green tick). Expand it to see `status: 0x1 Transaction mined and execution succeed`, the **transaction hash**, **block number** and **contract address**.
5. Under **Deployed Contracts**, the new instance appears. Copy its **address** with the copy icon. Note the **block number** too.

> Do not deploy to Polygon mainnet. CropLedger's dashboard refuses every chain except Amoy (80002) and local Hardhat (31337).

---

## 7. Check the deployment on the block explorer

Open (replace the placeholders):

- Transaction: `https://amoy.polygonscan.com/tx/<deployment tx hash>` — status **Success**, *To: Contract Creation*.
- Contract: `https://amoy.polygonscan.com/address/<contract address>`.

Make sure you use the **Amoy** explorer (`amoy.polygonscan.com`), not `polygonscan.com` (mainnet).

*Optional — publish the source on the explorer:* Remix's **Contract Verification** plugin can verify the contract on Sourcify (no key) or on Etherscan-family explorers (needs an API key; keep it out of the repository). Use exactly the compiler settings from step 3.

---

## 8. Connect the dashboard (address + ABI)

Remix does **not** synchronise with the dashboard automatically. Transfer two things:

### 8.1 Contract address (always needed)

Either:

- **Runtime (no restart):** dashboard → **System Configuration** → Network: *Polygon Amoy Testnet (80002)* → paste the address → optionally the deployment block → **Save settings** → **Run checks**. Settings are stored in this browser and override `.env`.
- **`.env` (default for everyone using this clone):**
  ```bash
  cp .env.example .env
  ```
  then edit:
  ```dotenv
  VITE_CHAIN_ID=80002
  VITE_CONTRACT_ADDRESS=0xYourDeployedAddress
  VITE_RPC_URL=https://polygon-amoy.drpc.org
  VITE_DEPLOY_BLOCK=<deployment block number>
  ```
  and restart `npm run dev`. These values are public (they end up in the browser bundle) — never put keys in `VITE_` variables.

**Run checks** in System Configuration should report: RPC chain 80002, contract code present, EIP-712 domain `CropLedger` v`1`, `READING_TYPEHASH` matching, and whether your connected account is the owner.

### 8.2 ABI (only if you changed the contract)

The repository ships [`abi/CropLedger.json`](abi/CropLedger.json), generated from the same `contracts/CropLedger.sol` you deployed, so **no ABI action is needed** for the unchanged contract. If you edited the contract in Remix:

1. Copy the edited source back into `contracts/CropLedger.sol`.
2. Either run `npm run export-abi` (regenerates the ABI from the source), or paste the array from Remix's **ABI** copy button into `abi/CropLedger.json` (the file contains only the JSON array).
3. Run `npm run abi:check` and `npm test` — the tests fail if the ABI and source disagree.

---

## 9. Register a device

Only the owner (`initialOwner`) can register devices.

### Option A — from the dashboard (simplest)

Device Registry → *Generate key & register* → MetaMask confirms a `registerDevice` transaction. The simulated device key is created in the browser; only its public address goes on-chain.

### Option B — from Remix (shows the raw call)

Create a simulated device with the CLI (its key is stored in the gitignored `.simulator/` folder):

```bash
npm run sim -- device:create --id CL-DEV-0001 --field FIELD-A1
```

It prints the four `registerDevice` arguments, e.g.:

```
deviceId:     0x434c2d4445562d30303031000000000000000000000000000000000000000000   ("CL-DEV-0001")
signer:       0x…(device public address)
fieldId:      0x4649454c442d4131000000000000000000000000000000000000000000000000   ("FIELD-A1")
firmwareHash: 0x213487a167bdf7e1cc1ce1c29d5ed4b9142a16ae702e1f00e1a5c4614ca21c23   (firmware 1.4.2)
```

In Remix → Deployed Contracts → expand the instance → expand **registerDevice** → paste the four values → **transact** → confirm in MetaMask. The terminal shows the mined transaction; expand it to see the `DeviceRegistered` log.

(A device registered in the dashboard can also be registered from Remix: Device Registry → *Remix args* shows the same four values.)

---

## 10. Submit a signed reading

A reading must be **signed by the device key** with EIP-712 for this exact chain and contract, so the signature is produced by the project code, not typed by hand.

### Option A — dashboard

Live Sensor Feed → *One reading* (the device signs) → *Submit* → MetaMask confirms `submitReading`. The feed row moves through *Preflight → Awaiting wallet → Pending → Confirmed* and shows the block number and an Amoy explorer link.

**About the fee in the MetaMask pop-up.** Polygon refuses any transaction whose *priority fee* (tip) is below **25 gwei**, even on Amoy, and it does so only *after* you confirm in MetaMask. Wallets estimate the tip from recent blocks, and Amoy's many empty blocks can push that estimate below the minimum. The dashboard therefore proposes its own fee (Polygon's gas station value, never below 30 gwei); MetaMask shows it as **"Site suggested"** — leave it as it is. If you edit the fee in MetaMask, keep the priority fee at 25 gwei or more. One reading costs roughly 100–135 thousand gas, i.e. about 0.003–0.004 POL at 30 gwei.

If a submission still fails, the feed row and the Transactions page now show the reason in plain language plus the node's exact message (*Technical detail*), and the row offers **Retry** for the same signed reading.

### Option B — Remix, with CLI-generated arguments

```bash
npm run sim -- remix-args --device CL-DEV-0001 --contract 0xYourDeployedAddress --chain-id 80002
```

Output (shortened):

```
submitReading arguments (any account may submit; paste each field into Remix):
  deviceId:  0x434c2d4445562d3030303100…
  r:         [1792340637, 149, 33, 181, "0x2f5ceb…"]
  nonce:     1
  signature: 0x3417f7…1c

verifyReading after it is recorded (index = getReadingCount - 1):
  genuine payloadHash  → true : 0x2f5ceb…
  tampered (N + 1)     → false: 0x76622a…
```

In Remix expand **submitReading**, paste `deviceId`, the tuple `r` exactly as printed (`[timestamp, n, p, k, "payloadHash"]`), `nonce` and `signature`, then **transact**. Any account may submit — the contract trusts the device signature, not the sender. The full off-chain payload is saved to `.simulator/payloads/…` for later verification.

The reading's timestamp may not be more than 15 minutes ahead of the block time; generate the arguments shortly before submitting.

---

## 11. Inspect the event and the transaction

- **Remix terminal:** click the mined `submitReading` transaction → **logs** show `ReadingRecorded(deviceId, fieldId, index, nonce, timestamp, n, p, k, payloadHash, submitter)`; *gas used* is shown too.
- **Explorer:** `https://amoy.polygonscan.com/tx/<hash>` → *Status: Success*, block number, gas used; the **Logs** tab shows the same event (decoded once the contract source is verified).
- **Dashboard:** Transactions page lists the hash with an Amoy link; *Network & Consensus* traces it from device to contract event with live confirmations; *Evidence Explorer* → *Inspect* → *Find transaction* locates it from the stored block number.

---

## 12. Verify the reading

Read-only calls cost no gas. In Remix (blue buttons):

| Call | Expected |
|---|---|
| `getReadingCount(deviceId)` | `1` (or the number recorded) |
| `getReading(deviceId, 0)` | tuple with timestamp, n, p, k, nonce, blockNumber, payloadHash |
| `verifyReading(deviceId, 0, <genuine payloadHash>)` | `true` |
| `verifyReading(deviceId, 0, <tampered payloadHash>)` | `false` |

The CLI's `remix-args` output gives both hashes. In the dashboard, the **Verification Lab** performs the same `verifyReading` calls after recomputing the keccak256 hash of the canonical payload in the browser.

---

## 13. Show that tampering and replays are rejected

| Attempt | How (Remix) | Expected |
|---|---|---|
| **Tampered payload** | `verifyReading` with the *tampered* hash from step 12 | returns `false` |
| **Gateway alters a value** | `submitReading` with the same arguments but change `n` inside `r` | Remix's gas estimation fails: *execution reverted* with custom error **`InvalidSignature`** — the device never signed that value. Do not force-send. |
| **Replay** | `submitReading` again with the exact arguments that already succeeded | reverted: **`StaleNonce`** |
| **Unregistered device** | arguments from a device that was never registered (`npm run sim -- device:create --id ROGUE-01` then `remix-args`) | reverted: **`UnknownDevice`** |
| **Revoked device** | owner calls `revokeDevice(deviceId)`, then submit new arguments | reverted: **`DeviceNotActive`**; `getReadingCount` and `verifyReading` still work for the old reading |

Remix decodes custom errors because they are part of the ABI. The dashboard's **Verification Lab → Attack scenarios** runs the same four attacks (preflight with `eth_call` by default, or broadcast to record a failed transaction on-chain).

---

## 14. Troubleshooting

| Symptom | Fix |
|---|---|
| `ParserError: Source not found` for OpenZeppelin | Wait for Remix to fetch `.deps`, check your connection, or use `npm run flatten` and upload the flattened file. |
| Compiler error about pragma | Select compiler `0.8.24` or newer (recommended `0.8.34`). |
| Remix shows another network | Switch MetaMask to Amoy; reselect *Injected Provider – MetaMask*. |
| *insufficient funds* | Get test POL from a faucet ([step 4.3](#43-get-test-pol)); wait for it to arrive. |
| Reading shows **Failed** right after you confirm in MetaMask — *"gas fee was too low"* / *transaction underpriced … minimum needed 25000000000* | Polygon's 25 gwei minimum priority fee. Update the project (`git pull`) so the dashboard proposes a compliant fee, keep MetaMask's *Site suggested* fee, then press **Retry** on the row. |
| **Failed** with *nonce … out of sync* | MetaMask's transaction counter disagrees with the chain (stuck earlier transaction, or a restarted local chain). MetaMask → Settings → Advanced → **Clear activity tab data**, then Retry. |
| **Unconfirmed** | MetaMask broadcast the transaction but no receipt was seen yet. Open the *Tx* link on the explorer: if it succeeded, the reading is recorded (Evidence Explorer shows it); if it was dropped, press Retry — the free preflight prevents a duplicate. |
| MetaMask *Could not fetch chain ID* when adding Amoy | The RPC is down or retired; use `https://polygon-amoy.drpc.org` ([step 4.2](#42-method-b--add-it-manually-in-metamask)). |
| `OwnableUnauthorizedAccount` | Only the `initialOwner` account can register or revoke devices. |
| `InvalidSignature` for a fresh reading | The arguments were signed for another contract or chain. Re-run `remix-args` with the right `--contract` and `--chain-id 80002`. |
| `InvalidTimestamp` | Arguments are stale or your clock is wrong; regenerate them. |
| Dashboard says *No contract code* | Wrong address or network in System Configuration. |
| Dashboard RPC errors | The public RPC may be rate-limited or down; in System Configuration set another Amoy endpoint (e.g. `https://polygon-amoy-bor-rpc.publicnode.com`), or change `VITE_RPC_URL` (public or domain-restricted key only). |
