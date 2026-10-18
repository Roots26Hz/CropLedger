# CropLedger — Oral Presentation Guide

A 4–6 minute live presentation **without slides**: you talk while showing Remix IDE and the running dashboard. Lines in quotes are suggested wording — say them in your own words. Timings are cumulative.

**Have open before you start:** Remix with the deployed contract (tab 1), the dashboard at `http://localhost:5173` connected to MetaMask on Polygon Amoy (tab 2), and the Amoy explorer (tab 3). Rehearse once with [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md). If the testnet is unavailable, use the local Hardhat chain or local demonstration mode and *say which one you are using*.

---

## Part 1 — Script (≈ 5 minutes)

### 1. Introduction (0:00–0:20)

> "CropLedger records soil-sensor readings from crop fields on a blockchain, so that anyone can later prove a reading is genuine, came from a registered device, and was not changed afterwards."

### 2. The real-world problem (0:20–0:45)

> "Field sensors measure nitrogen, phosphorus and potassium. Those readings decide fertiliser use, insurance claims and certification. Today they sit in one company's database, where a record can be edited or back-dated after a dispute, and the farmer, insurer and regulator have no shared copy they all trust."

### 3. Why blockchain (0:45–1:05)

> "A blockchain gives us a shared record that no single party controls and that cannot be rewritten. Smart contracts let us enforce rules — only registered devices, only correctly signed readings, no duplicates — on that shared record. We store a hash of each full reading, so any later edit is detectable."

### 4. Architecture (1:05–1:25) — point at the sidebar / README diagram

> "There are five layers. A simulated edge device in the field creates and signs readings. A gateway forwards them. The Polygon Amoy network orders them into blocks. Our CropLedger smart contract checks and stores them. And this dashboard lets us monitor, retrieve and verify the evidence."

### 5. Edge device simulation (1:25–1:40) — Live Sensor Feed

> "We don't have hardware, so this simulator generates realistic NPK, moisture, temperature and pH values, and runs a tiny on-device anomaly model — that's the edge-AI part."

**Do:** click **One reading**. **Expect:** a new row with N/P/K values, an edge-AI label and *signed*.

### 6. Signatures and payload hashes (1:40–2:00)

> "The device turns the reading into a fixed-format JSON payload and takes its keccak-256 hash — a fingerprint. It then signs the values and the hash with its own private key using the EIP-712 standard. The signature proves which device produced it; the hash protects the full payload."

### 7. Smart contract logic (2:00–2:35) — switch to Remix

**Show:** `CropLedger.sol`, the green compile tick, the deployed instance.

> "This is the contract in Remix, compiled with Solidity 0.8.34 and deployed to Amoy. When a reading arrives, `submitReading` checks five things: the device is registered, it isn't revoked, the nonce is new, the values are sane, and the signature recovers to the device's registered key. Only then does it store the reading and emit a `ReadingRecorded` event."

### 8. MetaMask integration (2:35–2:50) — back to the dashboard

> "The dashboard is connected to MetaMask. The wallet never shares its private key with the app; it only signs transactions that I approve."

### 9. Polygon Amoy testnet (2:50–3:00)

> "We use Polygon Amoy, a public test network: same technology as the main network, but the POL used for gas has no real value."

### 10. Live reading submission (3:00–3:30)

**Do:** click **Submit** on the reading → approve in MetaMask.
**Expect:** status *Preflight check → Awaiting wallet → Pending → Confirmed*, with a block number.

> "It's pending while it waits for a block… and now it's confirmed in block <number>. The app only says *confirmed* after the transaction receipt arrives."

### 11. Transaction verification (3:30–3:50)

**Do:** click the **Tx** link → PolygonScan Amoy.
**Expect:** *Status: Success*, block number, and the `ReadingRecorded` log.

> "Anyone can check this on the public explorer — it isn't just our dashboard's word."

### 12. Tampering demonstration (3:50–4:40) — Verification Lab

**Do:** select the reading → **Verify original**.
**Expect:** **VERIFIED — MATCHES THE LEDGER**.

**Do:** in *Altered copy*, change N (e.g. 142 → 167) → **Verify altered copy**.
**Expect:** almost every hash character turns red, *signature no longer matches*, **TAMPERING DETECTED**.

> "Imagine someone edits the stored record to make the soil look richer. One number changed, the hash is completely different, and the contract's `verifyReading` returns false. The edit is detected."

**If time allows** — *Attack scenarios* → **Replay attack** → *StaleNonce*; **Unregistered device** → *UnknownDevice*.

> "Sending the same signed reading twice is rejected because each nonce is accepted once, and a device that was never registered is rejected outright."

### 13. Security limitations (4:40–5:00)

> "One honest limitation: the blockchain proves what the device *reported* and that nobody changed it. It cannot prove the sensor itself was accurate — a faulty or tampered sensor still signs bad data. That needs calibration, secure hardware and firmware attestation."

### 14. Conclusion (5:00–5:20)

> "So CropLedger gives farmers, insurers and regulators one shared, tamper-evident record of field data, tied to registered devices and checkable by anyone. Next steps would be real ESP32 devices, batching readings to cut gas costs, and IPFS for the full payloads. Thank you."

---

## Part 2 — Expected outputs at a glance

| Step | You do | You should see |
|---|---|---|
| Connect | *Connect wallet* | Account chip `0x…` · Polygon Amoy Testnet, no red *Switch* button |
| Register | Device Registry → *Generate key & register* → approve | Device row *Active*, nonce 0 |
| Generate | Live Feed → *One reading* | Row with N/P/K, *normal* (or *anomaly*), *signed* |
| Submit | *Submit* → approve | *Pending* → *Confirmed* · block N · *Tx* link |
| Explorer | Click *Tx* | PolygonScan Amoy: Success, `ReadingRecorded` log |
| Verify | Lab → *Verify original* | VERIFIED |
| Tamper | Change N → *Verify altered copy* | TAMPERING DETECTED |
| Replay | Attack scenarios → Replay | Rejected by contract · `StaleNonce` |
| Unregistered | Attack scenarios → Unregistered | Rejected by contract · `UnknownDevice` |
| Revoked | Attack scenarios → Revoked | `DeviceNotActive` · history still verifiable |

**If something fails live:** say what the error message says — the app explains it in plain language (wrong network, rejected in wallet, RPC unreachable). Switching to the local Hardhat chain or local demo mode is fine; say clearly that it is local.

---

## Part 3 — Key concepts in one breath each

| Concept | Say |
|---|---|
| **Smart contract** | "A program stored on the blockchain whose code and data everyone can see, and that runs exactly as written — nobody can change its rules after deployment." |
| **Transaction** | "A signed request to change blockchain state, like calling `submitReading`. It's broadcast, included in a block, and gets a receipt saying success or failure." |
| **Wallet** | "Software that holds my private key and signs transactions for me. MetaMask never gives the key to the website — it only shows me what I'm approving." |
| **Gas** | "The fee for the computation a transaction uses, paid in the network's coin. A reading costs about 100 000 gas units here; reads like `verifyReading` are free because they don't change state." |
| **Testnet** | "A practice copy of a blockchain network with free test coins. Amoy behaves like Polygon's main network, so the demo is realistic without spending real money." |
| **Payload hash** | "A fixed-length fingerprint of the full reading. Change even one digit and the fingerprint is completely different, so comparing hashes detects any edit." |
| **Why signatures** | "Anyone can send a transaction, so the contract needs proof of *which device* produced a reading. Only the device's private key can produce a signature that recovers to its registered address." |
| **Replay attack** | "Re-sending a genuine, already-recorded message to count it twice. We stop it with a nonce — a counter that must always go up — so the same message can't be accepted again." |
| **Events** | "Logs a contract emits, like `ReadingRecorded`. They're cheap to write and easy for apps and explorers to search, so they're our activity history." |
| **Contract owner** | "The account that registers and revokes devices — say a cooperative or regulator. The owner cannot edit or delete recorded readings." |
| **Why not sensor accuracy** | "The chain only sees the numbers the sensor reported. If the sensor is broken or someone tampers with it physically, it still signs wrong numbers. We prove integrity and origin, not truth." |

---

## Part 4 — Likely viva questions

**1. Why not just use a normal database with access control?**
"Because whoever runs the database can still change it, and the other parties have to trust them. Here the record is shared and can't be rewritten, and the rules are enforced by code everyone can inspect."

**2. Why store only a hash instead of the full reading?**
"Storage on-chain is expensive and public. The hash is 32 bytes, yet it's enough to detect any change to the full payload. We do store the key values — timestamp, N, P, K, nonce — for easy queries."

**3. How exactly does tamper detection work?**
"We rebuild the payload in a fixed canonical format, hash it with keccak-256 in the browser, and call `verifyReading`, which compares that hash with the one stored when the reading was recorded. Different hash, different payload."

**4. What is EIP-712 and why use it?**
"It's a standard for signing structured data. The signature covers named fields plus a *domain* — the contract address and chain ID — so a signature made for our contract on Amoy can't be reused on another contract or chain, and wallets can display what is being signed."

**5. Who pays the gas — the device?**
"No. The device only signs. The gateway — in the dashboard that's the MetaMask account — submits the transaction and pays gas. The contract trusts the device's signature, not the sender, so even an untrusted gateway can't forge or alter readings."

**6. Can the gateway change a value before submitting?**
"It can try, but the signature then doesn't match the changed data and the contract rejects it with `InvalidSignature`. We demonstrate that in the attack lab."

**7. What happens if a device is stolen or its key leaks?**
"The owner revokes it. From then on every new reading from it is rejected, while its earlier readings stay on record and remain verifiable. A revoked device ID can never be registered again."

**8. What stops someone replaying an old reading?**
"Each device has a nonce that must be strictly greater than the last accepted one. Replaying the same message fails with `StaleNonce`."

**9. What if the gateway drops a reading?**
"Then that nonce is simply missing — the contract allows gaps — and the gap itself is visible. A gateway can delay or drop data, but it can't fake it."

**10. Why Polygon Amoy?**
"It's EVM-compatible, so Solidity, MetaMask and ethers.js work unchanged; it's a free public testnet with a public explorer; and Polygon's main network has low fees, which suits frequent sensor readings."

**11. What's the difference between *submitted* and *confirmed*?**
"Submitted means the network accepted the transaction into its pool and we have a hash. Confirmed means it's in a block and the receipt says it succeeded. We only show *confirmed* after the receipt."

**12. Does your dashboard run consensus?**
"No. It watches the result through an RPC node — blocks, receipts, confirmations. The validator animation is clearly labelled as an illustration."

**13. How much does a reading cost?**
"On our local test network, the first reading of a device used about 134 000 gas and later ones about 100 000. The cost in POL depends on the gas price, and we haven't measured it on Amoy. Batching readings into a Merkle root would cut the per-reading cost a lot."

**14. What does the owner control? Isn't that centralised?**
"The owner only manages which devices are trusted; it can't edit or delete readings. Registrations are public events, so they can be audited. In a real deployment the owner would be a multisig or a consortium of farmers, insurers and regulators."

**15. How do you know the local demo mode behaves like the contract?**
"A test runs the same scenario against both — valid readings, replays, forgeries, revocation — and requires identical results. Local mode is also clearly labelled and never shows fake transaction hashes."

**16. Why is the Solidity code only in Remix?**
"That's where we compile, deploy and interact with it directly. The dashboard only needs the contract's ABI — its interface — and its address."

**17. What is the ABI?**
"The Application Binary Interface: a JSON description of the contract's functions, events and errors. ethers.js uses it to encode calls and decode results. We copy it from the compiled contract; a test checks it hasn't drifted."

**18. What are the main limitations?**
"Sensor accuracy isn't proven, device keys in the simulation are kept in the browser rather than secure hardware, one transaction per reading is costly at scale, and full payloads must be stored off-chain by someone."

**19. How would this work with real hardware?**
"An ESP32 or similar board would hold the signing key in a secure element, compute the same canonical payload and EIP-712 signature, and send it over LoRa or Wi-Fi to the gateway. The contract wouldn't change."

**20. How did you test it?**
"107 automated tests: 49 Hardhat tests for the contract, the gateway and the local-mode parity, and 58 unit tests for payloads, signing, the simulator and the frontend services. They run on every push in GitHub Actions."

---

## Part 5 — Conclusion (if asked to summarise in 20 seconds)

> "CropLedger turns field-sensor readings into evidence that is signed by a registered device, stored on a shared ledger, and verifiable by anyone — and it shows clearly that the blockchain guarantees integrity and origin, not the accuracy of the sensor itself."
