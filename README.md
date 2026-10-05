# ARDS Sim

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

## Repository and deployment contents

The static build includes only `index.html`, styles, local fonts/assets, application modules and `.nojekyll`. Model assumptions and equations are available in the app. Source, tests, executable benchmark harnesses, package files and GitHub Actions remain tracked for reproducible development and deployment.

Agent handoffs/reviews, the local `docs/` folder, `.codex/` preferences, preview images and generated benchmark results are ignored and are not deployed. Existing local copies are retained; a fresh clone does not require them. Run the included harnesses to regenerate local results.

Runtime code is original and has no production dependencies. Explain was tested separately as an upstream reference; it is not bundled in this release. The app contains no clinical records. MIT license.
