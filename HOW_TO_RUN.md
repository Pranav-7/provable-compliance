# How to run the demo

This guide assumes nothing. Follow the steps in order; each one says what you should see.

**Time needed:** about 10 minutes the first time (mostly downloads), under a minute afterwards.

---

## Step 0: Put the project in your folder

If you received the project as `provable-compliance.zip`, double-click it in Finder to unzip it, then move everything inside into your `Demo` folder (or simply use the unzipped folder as your project folder).

---

## Step 1: Check that Node.js is installed

Open the **Terminal** app (on a Mac: press `Cmd + Space`, type `Terminal`, press Enter).

Type this and press Enter:

```bash
node -v
```

**What you should see:** a version number such as `v22.11.0`.

- If the number starts with **20, 22 or 24** (and 20 is at least 20.10), you are ready. Go to Step 2.
- If you see `command not found`, or a number lower than 20, install Node.js:
  1. Go to **https://nodejs.org**
  2. Download the **LTS** version for your computer and run the installer.
  3. Close Terminal, open it again, and run `node -v` once more.

---

## Step 2: Go to the project folder

In Terminal, move into the folder that contains this file. For example, if the folder is called `Demo` and is on your Desktop:

```bash
cd ~/Desktop/Demo
```

Tip: you can type `cd ` (with a space), then drag the folder from Finder into the Terminal window, then press Enter.

**Check you are in the right place:**

```bash
ls
```

**What you should see:** a list that includes `start.js`, `package.json`, `README.md` and `HOW_TO_RUN.md`.

---

## Step 3: Start everything with one command

```bash
npm start
```

**What you should see:** a short checklist that fills in line by line:

```
  Provable Compliance · from enforcement to evidence

  Installing dependencies                   done 92.4s
  Building ZK circuit and verifier          done 21.7s  UltraHonk verifier generated
  Compiling smart contracts                 done 6.1s
  Building the web UI                       done 6.3s
  Starting local blockchains                done 1.2s  :8546
  Deploying contracts                       done 2.0s  HonkVerifier + 5 contracts
  Starting bank service                     done 1.9s  127.0.0.1:8789
  Starting wallets and prover               done 4.8s  127.0.0.1:8790
  Starting independent auditor              done 3.0s  127.0.0.1:8791
  Serving the web UI                        done 0.0s  127.0.0.1:3000

  ● Ready. Open http://localhost:3000
  Press Ctrl+C to stop.
```

- The **first run** downloads packages and a small public file used for zero-knowledge proofs, so it takes a few minutes. Later runs skip those steps and say `up to date`.
- Your browser opens **http://localhost:3000** automatically. If it does not, open that address yourself.
- **Leave this Terminal window open** while you use the demo. Closing it stops the demo.

---

## Step 4: Walk through the demo

The demo is one case study, **interbank settlement**: tokenised deposits (`dDEP`) between Issuing Bank Treasury, Partner Bank, Regional Bank and a Payments Firm.

Use the buttons on each screen, or the **← →** arrow keys to move between steps.

| Screen | Press | What you should see |
|---|---|---|
| **0 · Overview** | *Start the walkthrough* | The eight-layer picture and the participants. |
| **1 · Publish the policy** | Click a country to remove it, then *Restore version 1*, then *Publish v1 on-chain* | The fingerprint changes completely when you remove one country. After publishing, an "On-chain policy registry" card appears with a block number. |
| **2 · Issue credentials** | *Onboard counterparties and issue credentials*, then *1 · Holders prove eligibility*, then *2 · Issue deposit tokens* | Four leaves build up into a root. Three banks get a receive pass after a few seconds of proving; the Payments Firm cannot. Balances appear. |
| **3 · A compliant transfer** | *Generate proof and send* | A timer runs while the proof is generated, then "Settled on-chain". Two panels compare what the sender proved with what the chain sees, including the sealed audit envelope. |
| **4 · Revocation on every route** | *Sanction Regional Bank*, then *Try* on each of the four attempts | The leaf turns red and the root changes. Attempt 1 is stopped by the issuing bank's compliant node. Attempt 2 goes through Regional Bank's own node and is rejected by the token: the same rule holds without the issuing bank's node in the path. |
| **5 · The audit trail** | *Run a trading day* (about a minute), then *Publish root on-chain*, then *Audit … attempt via …*, then *Verify against on-chain root*. Then, under **Step 2**, *Re-check record* in **Proof only**, switch to **Proof + data** and re-check again | The tree builds level by level, one path lights up and verification succeeds on-chain. The independent auditor re-checks the decision: with proof only it confirms the outcome without learning anything about the holder; with proof + data it opens the sealed envelope and shows the holder's attributes and why the transfer was blocked. *Alter this record* turns the root red: "Root mismatch". |
| **6 · Recap** | | What the market saw versus what the auditor could verify. |

**Useful controls (bottom left):**
- **Technical detail:** shows full hashes, transaction hashes, gas, and the extra explanation under each panel. Leave it off when presenting so each screen shows only its result.
- **Reset demo:** returns the demo to the start of Screen 1, so you can present again.

---

## Step 5: Stop the demo

Click the Terminal window and press **Ctrl + C**.

**What you should see:** `Stopping all services…` and the prompt returns.

To run it again later, repeat Step 2 and Step 3.

---

## If something goes wrong

| Message | What to do |
|---|---|
| `Node.js … is too old` | Install the LTS version from https://nodejs.org (Step 1). |
| `Port 3000 (web) is already in use` (or 8546, 8789 to 8791) | A previous run is still open. Close that Terminal window, or press Ctrl+C in it, then try again. |
| `npm install failed` | Check your internet connection and run `npm start` again. |
| `Could not build the circuit verifier` | The first run needs internet to download the proving setup. Check your connection and try again. If you are offline, run `npm run start:dev-proofs` instead (the circuit still runs, but proofs are not real ZK proofs; the sidebar will say "Development proofs"). |
| The page shows an error banner | Click **Reset demo** and repeat the screen. |
| Anything else | Look at the log files in the `.runtime/logs` folder; each service writes its own file there. |

---

## Optional: run the tests

```bash
npm test
```

This runs the full test suite, including real zero-knowledge proofs verified by the smart contracts. It takes a few minutes. At the end, every group should report `# fail 0`.
