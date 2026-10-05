# ARDS_Sims

[Open the simulator](https://kamia121.github.io/ARDS_sim/)

A browser educational simulator for heterogeneous regional lung mechanics. Guided lessons compare a baseline with one ventilator adjustment and explain the model tradeoffs. Compare seeded patients, recruitment history, chest-wall load, and regional distension under the same ventilator settings. This release is an uncalibrated educational model, not a patient-specific predictor or a PEEP optimizer.

## Run locally (Mac or Windows)

Install Node.js 22 or newer. In this folder:

```sh
npm ci
npm test
npm start
```

Open http://127.0.0.1:5173. No API keys or cloud inference are needed. Do not open index.html with file:// because the module worker requires HTTP.

```sh
npm run bench
npx playwright install chromium
npm run bench:browser
npm run build
```

The browser has its own device benchmark and JSON export. The static release is built in `dist/`. GitHub Actions workflows verify and deploy that directory after Pages is configured to use GitHub Actions.

## Read before extending

- [Teaching guide](docs/TEACHING_GUIDE.md)
- [Model specification](docs/MODEL_SPEC.md)
- [Engine comparison and decision](docs/ENGINE_DECISION.md)
- [Recorded benchmarks](docs/BENCHMARK_REPORT.md)
- [Next Codex task and remaining requirements](docs/CODEX_NEXT_TASK.md)
- [Mac/Windows and GitHub handoff](docs/LOCAL_HANDOFF.md)
- [Independent Claude review brief](docs/CLAUDE_REVIEW_BRIEF.md)

Runtime code is original and has no production dependencies. Explain was tested separately as an upstream reference; it is not bundled in this release. The app contains no clinical records. MIT license.
