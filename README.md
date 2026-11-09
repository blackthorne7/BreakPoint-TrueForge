# TrueForge starter: an agent that gets better every time it runs

Starter repo for the **Stranger Builds** challenge *"Build an agent that gets better every time it runs"* (sponsor: [TrueForge](https://trueforge.dev) by TrueFoundry).

It gives you a working loop on day one, so you spend the week on the agent:

```
run the evals ──► score ──► the agent rewrites its own instructions/skill ──► run again ──► higher score?
   (TrueForge session)         (from its failures, committed with Agent-Session: <id>)
```

The example agent triages **recorded security evidence** in seven compact, fictional offline cases. It classifies each case as `confirmed_vulnerable` or `unconfirmed`, then cites evidence IDs for categorized findings. The cases are curated fixtures, not scanner runs; no live scanning or exploit code is used. One case is held out from improvement.

## Run 1 vs run N

- **Task and score:** Triage seven fictional recorded-evidence cases. Wrong verdict scores 0; correct verdict scores 0.4 + 0.6 × exact category/citation-set F1. Pass requires exact verdict and finding set.
- **Run 1 → run N:** Run 1 scored **100/100 (7/7 passed, including the holdout)**; no later run has been made.
- **The change that did it:** No self-change or improvement cycle has been demonstrated. Run 1 used agent commit `1d60a7bfc77622fa780e88df471e5d5d76de2c99` (session `01m6t2p7k0kp4qg3ztpfjkxss2`).
- **What the agent learned:** Nothing has been established through run-to-run comparison; every case already passed on run 1.
- **What still fails:** The score has an accuracy ceiling and only checks structured verdicts, categories, and citations; no gain is proven. Do not run `improve` on this all-passed set; redesigning tasks requires a separately versioned experiment.

## What the challenge asks

Build an agent on TrueForge that looks at its own runs, rewrites its own skills or instructions, and does the job better the next time. Then prove it in a public repo. You **complete** the challenge when your repo shows all four:

1. **GitHub:** a public repo, created on or after Sat 31 Oct, **not a fork** (made from this template is fine).
2. **TrueForge runtime:** your agent runs on TrueForge, and each run you count is a TrueForge session.
3. **Run 1 vs a later run:** same tasks, same scorer. The later run comes after at least one change the agent made to itself.
4. **The agent changed itself, and it got better:** a commit with the agent's change to `agent/`, between run 1 and the later run, ending with `Agent-Session: <session_id>`, and a higher score after it.

The rule: **the agent writes the change.** You can review it, keep it or drop it. You don't write it.

## What's in here

```
agent/
  agent.json                      name, description, model, skill_mode (inline | git)
  instructions.md                 the agent's instructions (its system prompt)
  skills/review-checklist/SKILL.md  initial triage playbook; the agent may revise it
evals/
  tasks/*.json                    seven fixed cases (one holdout is scored, never shown to improve)
  contract.ts                     task loader, model-visible prompt, validator and fingerprint
  score.ts                        deterministic verdict/finding scorer
  replay.ts                       stable replay export shape for run data and synthetic examples
scripts/
  setup.ts                        create/update the TrueForge agent from agent/
  run-evals.ts                    one run = one TrueForge session; scores it, saves runs/run-NN/, adds a row to summary.csv
  improve.ts                      the agent reads failed training cases and revises only existing agent files
  export-session.ts               save any TrueForge session (session, turns, events) as JSON
  lib.ts                          shared helpers (TrueForge SDK client, git, files)
runs/summary.csv                  one row per run
examples/replay-*.json            clearly marked synthetic UI examples, generated through the scorer
demo/                             replay-only evidence console
Dockerfile, Kraftfile              local container and Unikraft deployment definitions
docs/demo.md, docs/deployment.md   console and deployment notes
```

## Quickstart (about 5 minutes)

You need Node.js 22.14+, git, and one model key (a TrueFoundry AI Gateway key, your own OpenAI/Anthropic/Gemini/... key, or any OpenAI-compatible endpoint).

**0. Make your repo** (on or after Sat 31 Oct). On GitHub, click **Use this template → Create a new repository**. Don't fork. Then clone it.

**1. Start TrueForge** in its own terminal, and keep it running:

```bash
npx @truefoundry/trueforge@latest
```

Open http://localhost:8790 → **Settings → Models** → pick your provider → paste your key → **Create**. Note the model name it shows, written `provider/model` (e.g. `anthropic/claude-sonnet-4-6`, `openai/gpt-5.2`).

**2. Install and configure:**

```bash
npm install
cp .env.example .env
# Set TF_MODEL=provider/model in the ignored .env file.
# For git-backed skills, also set SKILL_REPO_URL to your public repository URL.
```

**3. Create the agent:**

```bash
npm run setup
# ✓ Agent "evidence-triage" (...) is in sync with agent/ at 1a2b3c4
```

It's now under **Agents** in the TrueForge UI; click **Try** to chat with it.

**4. Run 1 (your baseline):**

```bash
npm run run-evals
# Run 01: agent "evidence-triage" at 1a2b3c4, 7 tasks
#   case-k7m2                <score>
#   ... (one line per case)
# Run 01 score: ... (..../7 tasks passed, ... tokens)
# ✓ Committed runs/run-01. Next: npm run improve
```

After run 1, **don't change the fixed task/scorer/prompt contract.** The run script records its SHA-256 and rejects later runs if it changes. Each run writes the fingerprint to score/session metadata; the existing summary.csv columns stay unchanged.

**5. Let the agent improve itself, then run again:**

```bash
npm run improve      # the agent rewrites agent/ from its failures; committed with Agent-Session: <id>
git show             # review it. Keep it, or drop it: git reset --hard HEAD~1 and improve again
npm run run-evals    # run 2
```

Repeat as often as you like. Then fill in **Run 1 vs run N** above, and push.

## The loop, step by step

**`npm run run-evals`**
1. Refuses to run if `agent/` or `evals/` has uncommitted changes, so `agent_commit` always says exactly what ran.
2. Syncs the TrueForge agent with `agent/` (`agents.update`), so the files and the agent can't drift.
3. Opens **one TrueForge session** for the run. Each task is one **root turn** in it (`previousTurnId: "none"`), so tasks don't see each other.
4. Scores every reply with `evals/score.ts`, exports the session, and writes:
   - `runs/run-NN/results.json`: each reply and its score details
   - `runs/run-NN/score.json`: the run's numbers
   - `runs/run-NN/session.json`: the session, its turns and every event, from TrueForge
   - `runs/run-NN/replay.json`: UI replay records with observations, parsed findings, scorer diagnostics and source IDs
   - a new row in `runs/summary.csv`: `run, session_id, agent_commit, score, date_utc, tasks_passed, tasks_total, tokens, tool_calls, duration_s`
5. Commits `runs/` as `run NN: score X` (skip with `--no-commit`).

**`npm run improve`** (options: `--run NN`, `--coach`, `--no-commit`)
1. Takes failed training cases from the last run (the holdout is derived from the current task definition and excluded). It provides the agent's prior response and aggregate scorer diagnostics, but not expected categories, evidence IDs, or rationale.
2. Opens a TrueForge session **with the agent itself** and asks it for new versions of its files. With `--coach`, a separate inline TrueForge "coach" agent on the same model writes them instead (allowed: "the agent, or a TrueForge agent coaching it").
3. Checks the answer: only existing instruction/skill files may change; skills keep their frontmatter; the output protocol stays exact; and fixture IDs, titles, targets and observation text may not be copied into the playbook.
4. Writes the files, saves the improve session to `runs/run-NN/improve-session.json`, and commits:

   ```
   agent: learn from run 01

   I only checked three kinds of problems; I now also check ...

   Agent-Session: 01m5sab7yga874pqmr33w87hra
   ```

**`npm run export-session -- <session_id> [out.json]`**: any session as JSON (e.g. one you ran in the UI). TrueForge has no export button yet; this pages through `sessions.get`, `sessions.listTurns` and `sessions.listTurnEvents`.

**`npm run score -- runs/run-NN`** re-scores a saved run. **`npm run score -- --selftest`** checks the scorer. Offline checks: `npm run evals:validate`, `npm run evals:test`, and `npm run replay:example`.

Score formula: a wrong verdict earns zero. A correct verdict earns `0.4 + 0.6 × F1`, where a finding matches only when category and the full supporting evidence ID set match exactly. Extra, duplicate, and incorrectly cited findings reduce precision; missed findings reduce recall. A pass requires correct verdict and the exact finding set. The scorer checks structured labels and citations, not the truth or quality of a free-text explanation, so scores are a limited proxy for triage quality.

`agent/agent.json` caps completions at 1,024 tokens; the runtime also has a four-iteration limit. Keep the playbook and responses short. The contract fingerprint covers task JSON, task/prompt code, and scorer code; it does not fingerprint the model, environment variables, or the TrueForge runtime configuration.

`npm run replay:example` generates perfect and partial **synthetic** records for the Shelled UI contract from a fixed fixture and the same scorer. They use `synthetic: true`, with `run_id` and `session_id` set to `null`; they are not measured runs.

See [docs/replay-contract.md](docs/replay-contract.md) for the replay JSON schema and field meanings.

Review saved results locally with the [BreakPoint evidence console](docs/demo.md) (`npm run demo`), or open the [live evidence console](https://breakpoint.sfo.unikraft.app/). See [deployment notes](docs/deployment.md) for Docker and Unikraft.

## Make it yours

Pick your task and your scorer **before run 1**; after run 1 they're frozen.

- **The agent:** edit `agent/agent.json` (name, model), `agent/instructions.md` and the skill. Rename or add skills under `agent/skills/<name>/SKILL.md`.
- **The tasks:** put 3 or more in `evals/tasks/*.json` (5+ makes your score harder to argue with). Mark one or two `"holdout": true`: they count in the score, but `improve` never shows them to the agent. If the holdout score goes up too, the agent learned something general.
- **The prompt per task:** `taskPrompt()` in `evals/contract.ts`.
- **The scorer:** `evals/score.ts`. It must give **one number, higher is better**: tasks passed, a checker, tests, a judge prompt. Want to measure "cheaper"? Use tasks solved per 1,000 tokens (`score.json` has the tokens).
- **The improve prompt:** in `scripts/improve.ts`; its guard allows only existing agent files and rejects fixture memorization.

Some ideas from the challenge brief: a PR reviewer that sharpens its checklist; issue → PR with memory (run tests in the sandbox); an overnight janitor on a TrueForge schedule; subagents that coach each other; the cheaper agent.

## Skills and the sandbox

`agent/agent.json` has `"skill_mode"`:

- **`inline`** (default, no sandbox, nothing to install): `setup` pastes each `SKILL.md` into the agent's instructions. The agent rewrites the files; `setup` pushes them with `agents.update`. Works everywhere, including Windows.
- **`git`**: real TrueForge [skills](https://trueforge.dev/skills). `setup` registers each `agent/skills/<name>` from your **public** repo (`SKILL_REPO_URL` in `.env`), pinned to the commit that runs, and turns the sandbox on. Push before each `run-evals`. Skills need a sandbox:
  - local `npx` on **macOS**: built-in local sandbox;
  - local `npx` on **Linux**: built-in local sandbox once `bubblewrap`, `socat` and `ripgrep` are installed (restart TrueForge after);
  - Windows or hosted setups: [Daytona](https://trueforge.dev/sandbox) (has a free trial).

The challenge asks you to use **two or more** of: skills, subagents, MCP tools, the sandbox, schedules, human checkpoints, the SDK. This starter already uses the SDK; `git` mode adds skills and the sandbox. Subagents are on by default in TrueForge agents.

### Local or open models

Any OpenAI-compatible endpoint works as a `custom` provider (**Settings → Models → Add custom provider**). If it runs on your own machine (Ollama, vLLM, LM Studio), TrueForge blocks private addresses by default; start it with your host allowed:

```bash
OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx @truefoundry/trueforge@latest
```

and use `http://127.0.0.1:<port>/v1` as the base URL.

## What the judges check

Automatically, for everyone:
- the repo is public, not a fork, and was created on or after 31 Oct;
- `agent/`, `evals/tasks/` (3+ tasks), `evals/score.*`, `runs/summary.csv` and this README with a **Run 1 vs run N** section exist;
- `summary.csv` has 2+ runs, and a later run scores higher than run 1;
- a commit that changes `agent/` and ends with `Agent-Session:` comes after run 1's commit and before the later run's.

For finalists, judges look deeper: they open the sessions (`runs/run-NN/session.json`), the diffs and the scorer, and may ask you to run it again live. Keep it honest: same tasks, same scorer, every run. The published evidence bundle and deployment image intentionally omit the full session export and any configured model-provider integration; this is not a complete judge artifact yet.

You also send: a video (up to 2 minutes), three lines (what it does, how it uses TrueForge, what it learned), and a half-page feedback note on TrueForge.

## Troubleshooting

- **`Can't reach TrueForge`**: is `npx @truefoundry/trueforge@latest` still running? Different port? Set `TRUEFORGE_BASE_URL`.
- **`Model "..." is not configured`**: add the provider in Settings → Models, and set `TF_MODEL` to the exact `provider/model` name shown there.
- **A task shows `[error: ...]`**: the model call failed (key, quota, model name). The run still saves; fix it and run again before you count it.
- **`agent/ or evals/ has uncommitted changes`**: commit them. (`--allow-dirty` exists for experiments; the row is marked `-dirty`, don't count it.)
- **`skills require a sandbox provider`** in `git` mode: see *Skills and the sandbox*.
- **The model rejects `temperature`** (some reasoning models do): remove `params` in `agent/agent.json`.

## Current status

The public evidence set includes official run 1 with a score of 100/100 (7/7 cases passed, including the holdout). It used contract fingerprint `2db044ebf3b426a7bcd10bcc47a3b3ade9c158a60efed8a7c66b185ce5c0b322`, agent commit `1d60a7bfc77622fa780e88df471e5d5d76de2c99`, and TrueForge session `01m6t2p7k0kp4qg3ztpfjkxss2`. The 14 model requests reported 41,175 tokens (39,961 input and 1,214 output) over 113 seconds. This was an authorized 40,000-token soft limit: the final response overshot it by 1,175 tokens, then inference stopped. Full-stream and turn usage matched and rescoring returned 100. The published console includes replay, score, and task results, but intentionally omits the full session export and configured model-provider integration.

No improvement has been demonstrated, and all seven tasks already pass, so there is no meaningful reason to run `improve` against this task set. Preserve this baseline; any task or objective redesign should be a separately versioned experiment with its own baseline. The scorer checks structured verdicts, categories, and citation sets, not free-text truth or general security skill. Schedule-based evaluation is out of scope for this foundation.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), including how to go for the **PR prize** by contributing to [TrueForge](https://github.com/truefoundry/trueforge) itself.

## License

MIT, see [LICENSE](LICENSE).
