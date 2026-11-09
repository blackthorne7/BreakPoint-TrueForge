# Local evidence console

The BreakPoint demo is a dependency-free local interface for reviewing saved replay records. It loads recorded task context, agent responses, scorer diagnostics, and the run metrics needed for an honest comparison. It does not run scans or make model calls.

## Start

Use Node.js 22 or newer:

```sh
npm run demo
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Choose another local port with `npm run demo -- --port 4300`, or allow network-interface connections with `npm run demo -- --host 0.0.0.0 --port 8080`.

The server serves only the demo’s four browser assets and two read-only API routes. `/api/runs` discovers valid `runs/run-NN/replay.json` files and includes a small allowlist of matching fields from `score.json`. It does not read or return session exports, result dumps, credentials, `.env`, `.local`, or arbitrary paths. `/api/examples` reads only the two named synthetic replay fixtures. Each replay is validated and projected without changing the replay-contract shape, so the curated JSON download remains a valid replay record.

The published evidence bundle and deployment image intentionally omit the configured model-provider integration and full session export. The hosted console is replay-only and is not a complete judge artifact. The current live deployment is the [BreakPoint evidence console](https://breakpoint.sfo.unikraft.app/).

## Reading the interface

- Recorded runs show measured status, score, task pass count, and optional token, elapsed-time, and tool-call metrics. A missing metric displays as unavailable.
- Run-to-run deltas compare the selected measured run with the earliest earlier run whose contract fingerprint and full ordered task context match. Synthetic mode hides measured comparisons.
- Synthetic examples are kept in their own selector mode and labeled as fixtures. Their scores are never presented as measured improvements.
- Select a task to review the verdict, findings, evidence citation chips, and the corresponding recorded observation cards. Observation content is displayed as text.
- Scorer diagnostics are collapsed by default. They include parsing errors, precision/recall/F1, and matched, missed, and noise details. The scorer checks structured verdicts, categories, and exact evidence citations; it does not grade explanation quality.
- The replay contract does not include revision history, so the revision panel explains that those details are unavailable here.

## Checks

```sh
npm run demo:test
```

Tests cover replay validation, source consistency, comparison eligibility, run discovery, and HTTP access boundaries.
