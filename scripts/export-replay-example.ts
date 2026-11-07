// Generate a clearly synthetic UI contract fixture from a fixed task and the production scorer.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contractFingerprint, loadTasks } from "../evals/contract.ts";
import { replayRun, syntheticPartialReply, syntheticPerfectReply } from "../evals/replay.ts";

const task = loadTasks().find((t) => t.id === "case-p6a3");
if (!task) throw new Error("Synthetic example task is missing");
const source = { run_id: null, session_id: null, synthetic: true } as const;
const contractHash = contractFingerprint();
const payload = replayRun([{ task, reply: syntheticPerfectReply(task) }], source, contractHash);
const partial = replayRun([{ task, reply: syntheticPartialReply(task) }], source, contractHash);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "examples");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "replay-synthetic.json"), JSON.stringify(payload, null, 2) + "\n");
writeFileSync(join(dir, "replay-partial-synthetic.json"), JSON.stringify(partial, null, 2) + "\n");
console.log("Wrote synthetic replay examples (synthetic=true; no run or session IDs)");
