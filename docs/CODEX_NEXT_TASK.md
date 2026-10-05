# Codex handoff: ARDS Sim

Continue this repository rather than starting a new project.

- Repository: https://github.com/kamia121/ARDS_sim
- Public site: https://kamia121.github.io/ARDS_sim/
- Display name: **ARDS Sim**. The repository name remains ARDS_sim.
- Requested development model: GPT-6.1 Sol, high reasoning; `.codex/config.toml` records this preference. Confirm the local client actually selects it.
- The user may work on a Mac mini or Windows PC. No connection or transfer to either computer has been performed from the originating session.
- The user requests independent Claude Opus 5.5/high review on the Mac mini if available. The initial read-only Opus 5.5 / High source review and planning follow-up are completed; see CLAUDE_OPUS_REVIEW.md, CLAUDE_OPUS_FOLLOWUP.md and CLAUDE_REVIEW_DECISIONS.md. Expanded physiology will require a further review after implementation.

## User requirements

Use professional, functional language. No slogans, promotional headlines, or `_kh` branding. The former “Same PEEP. Different lungs.” headline was removed. Keep the interface readable and teach the interpretation rather than expecting learners to already know it.

The first use case is a guided comparison of a controlled ventilator adjustment: record a same-seed baseline, change one variable, and explain recruitment, elastic-pressure and distension tradeoffs. Green describes more aerated tissue, grey less aerated tissue, orange within-breath aeration change, and red an assumed distension proxy at inspiration. Colors are not a clinical good/bad score. Higher compliance or lower driving pressure must not conceal increased regional distension. The current release is uncalibrated and does not identify a patient's best PEEP.

## Current implementation

The original reduced regional core has persistent pressure/time-dependent recruitment, nonlinear open-unit volume relations, chest-wall coupling, a pressure ceiling, paired phenotypes, standardized sweeps, and reproducible seeds. Default guided comparisons create fresh initial seeded patients and run ten breaths; separate history mode retains state. Metric explanations and baseline-to-adjustment narratives are implemented. Each lesson now includes an objective, prediction and reflection; comparison text identifies changed and held settings, explains the control mechanism and tradeoff, and warns about multiple-control changes. Guided adjustments restore baseline controls first. The interface follows VA_coupling_sim typography, palette, monitor panels and persistent light/dark mode; the header displays ARDS Sim without an edition label. Tests, raw benchmarks, equations and browser checks are in the repository. GitHub Actions tests/builds and deploys Pages.

Twelve core numerical checks, ten interpretation tests and ten worker/session tests pass. Baseline races, discarded-run retained history, derecruitment/unequal-volume narratives, stale unit details and keyboard unit inspection have been addressed. Twenty-four simulation cases exactly match the pre-review checkpoint. See DEVELOPMENT_PLAN.md for the reviewed sequence and acceptance criteria. Browser checks cover responsive layouts, state and sweep behavior, and all three guided lessons. The model is still quasi-static: no resisted airflow, realistic emptying, cardiovascular dynamics or continuous breathing animation is implemented.

Pulse, Explain, BioGears and smaller prototypes were considered. A pinned adult Explain Engine integration/throughput trial was executed; see ENGINE_DECISION.md and results-explain.json. Explain is not bundled in this release. Do not claim inherited upstream validation.

## Remaining requested work, in order

1. Verify the revised tutorial's usability with a learner. Identify a concrete learning objective for each scenario and remove unexplained measures. Preserve professional copy and accessible controls.
2. Animate inspiration/expiration from actual computed within-breath regional trajectories. Distinguish a visualization interpolation from a dynamic physiological solve. Respect pause, phase inspection and reduced-motion preferences.
3. Add resisted regional filling/emptying. The user specifically wants airflow rates, emptying ratios and the time constant for each regional line/unit. Define which emptying ratio is shown. Respiratory R×C time constants differ from recruitment opening/closing kinetics. Validate against an analytic single-compartment RC reference, mass balance, timestep refinement, pressure limits, and heterogeneous regional scenarios. A coupled chest wall means independent local RC estimates are not automatically the network's eigen-time constants.
4. Add cardiovascular/heart-rate interactions and intravascular pressure swings. The user confirmed they want both heart rate and airflow. Prefer evaluating a developed adult engine (Explain or Pulse) over inventing sinusoidal heart-rate changes. Separate intravascular pressure, surrounding pleural/pericardial pressure, and transmural pressure. Do not infer preload or a beneficial setting from CVP alone. Document one-way versus two-way respiratory coupling and any native-lung simplifications. Implement and test actual cardiovascular dynamics before presenting outputs as predictions. Keep current regional recruitment, gas exchange and vascular assumptions clearly separate.
5. Benchmark new dynamics on the actual Mac mini/Windows PC, preserving hardware/runtime/date/raw samples, and perform an independent Claude review of the implemented expansion before representing expanded physiology as ready.

A contemplated Explain adapter would impose the regional pleural-pressure trajectory on an adult circulation as a one-way pressure forcing. That adapter was researched but was not implemented. It still needs review of thoracic/pericardial pressure bookkeeping, native lung dynamics, baroreflex/chemoreflex effects and conservation. Upstream `pres_tm` field semantics should be verified rather than trusted by name. Do not report this idea as completed coupling.

## Development and release

Run `npm ci`, `npm test`, and `npm start`; open http://127.0.0.1:5173. For browser checks, run `npx playwright install chromium`, `npm run bench:browser`, and `npm run test:teaching-browser`. `npm run build` produces the static Pages artifact. Read AGENTS.md and MODEL_SPEC.md before changing physiology. Update tests and assumptions together, review changes, commit and push normally. No credentials or clinical records belong in the repository.
