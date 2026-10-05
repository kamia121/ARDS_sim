# Recorded benchmark report

Recorded 2026-10-05T18:18:00.392Z. Raw samples and environment are in `benchmarks/results-engine.json`, `results-browser-linux-baseline.json`, and `results-explain.json`. These are performance and numerical-verification results, not clinical validation.

## Runtime

Host: INTEL(R) XEON(R) PLATINUM 8573C, Linux x64, Node v24.19.0; headless Chromium 153.0.8010.0. No CPU throttling. Timings are environment-specific and subject to JIT, garbage collection and scheduling.

Workload: fresh high-recruitability patient, PBW 70 kg, PEEP 12, VT 6 mL/kg, RR 20, ceiling 45 cmH2O, ten breaths (30 simulated seconds), dt=0.1 s.

| Regions | Node median ms | Node P95 ms | Browser median ms | Browser P95 ms |
|---|---|---|---|---|
| 128 | 5.08 | 6.86 | 7.20 | 7.80 |
| 512 | 21.03 | 25.91 | 25.00 | 34.00 |
| 2048 | 84.65 | 93.91 | 96.10 | 169.20 |

Node: five warmups and 21 measured runs, includes patient creation. Browser: one warmup and seven measured runs, patient creation outside the timer, excludes plotting. P95 estimators/sample counts differ; these are separate measurements, not a claim that one runtime is faster. The 2,048-region Node series contains a 666 ms scheduling/GC outlier retained in the raw data.

One-patient standardized 22-step PEEP sweep (ascending then descending, ten breaths/step) Node median 446.20 ms, P95 469.01 ms. The paired UI reset (both 512-region patients, worker plus DOM/canvas updates) median 68.60 ms, P95 105.50 ms over seven runs. UI timings do not isolate compositor presentation and should not be described as frame latency.

## Numerical sensitivity

For the recorded 512-region seeded scenario, default dt=0.1 versus dt=0.0125 s reference: plateau pressure difference 0.7565%; EELV 0.6087%; aerated fraction 0.4242 percentage points (0.8492% relative). The assumed high-volume-ratio fraction differs 2.4140 percentage points. Hard threshold metrics are more timestep sensitive. Refinement is evidence of convergence for this scenario, not an exact reference solution or a bound across all scenarios.

Across ten seeds at 512 regions, aerated fraction mean 50.844%, sample SD 0.777 percentage points; plateau-pressure SD 0.216 cmH2O. Across-seed aeration means at 128/512/2048 regions are 50.780/50.844/50.705%, with SD 1.200/0.777/0.434 percentage points. Increasing random unit count improves Monte Carlo sampling; this is not spatial mesh convergence.

## Checks

Twelve engine checks pass: seeded reproducibility, constitutive monotonicity, analytic fixed-open linear mechanics, pressure-ceiling behavior, volume residuals, pressure/volume consistency, hysteresis, phenotype behavior, chest-wall response, sweep isolation, timestep refinement, and invalid-input handling. See the executable test file for exact assertions and scenarios.

Browser checks pass: reproducible reset, phase toggle, fresh isolated 22-step sweep, stale sweep invalidation, phenotype change, 320/390/1280 layout without overflow, module worker and device benchmark, documentation links, no page errors or failed requests. Layout was inspected at 1280, 390 and 320 CSS-pixel widths without horizontal overflow. Mobile emulation tested layout only; no physical phone, Mac mini or Windows PC was benchmarked. Desktop/mobile screenshots are included.

Three additional teaching interpretation checks verify tradeoff language, pressure-limited volume caveats, and arithmetic against actual engine results. `results-teaching-browser.json` records the guided-flow browser checks.

## Explain integration trial

Pinned Explain commit `c9fdc08c53d624bb9be5d52c66bd6ec145dd6170`, adult model with 171 components, timestep 0.0005 s. Seven sequential ten-second windows after a ten-second warmup: median 2799.45 ms, P95 2864.16 ms; about 3.57 simulated seconds per real second. Its full-body equations differ from this reduced model. No equal-workload speedup ratio or equivalence of clinical outputs is asserted.

To reproduce, clone https://github.com/explain-labs/explain-engine outside this repository, check out the pinned commit, then run `node benchmarks/explain-trial.mjs /absolute/path/to/explain-engine` from this project. The upstream harness may require the upstream documented setup.

## External validation gap and next benchmark stage

No CT, EIT, patient PV/recruitment curves, waveform dataset or experimental measurements calibrated this release. Plausible trends and small algebraic residuals do not close that gap. Next: choose a licensed adult dataset, define recruitment/volume/pressure targets and uncertainty before fitting, hold out patients or experiments for evaluation, compare a simpler global model, and report prediction errors across PEEP, dwell times and tidal volumes. Coupling to a whole-body engine should receive its own integration benchmarks and validation.

The initial Claude source review and planning consultation are now recorded in CLAUDE_REVIEW_DECISIONS.md; review of expanded physiology remains future work. Re-run the included device benchmark on the Mac mini and Windows PC and retain separate reports.

## Local interface verification, 2026-10-05

The earlier Linux measurements above are retained in `benchmarks/results-browser-linux-baseline.json`; `benchmarks/results-browser-learner-checkpoint.json` records that learner/theme checkpoint browser run. Host: macOS arm64, Node v24.4.0, headless Chromium 151.0.7922.34. The CPU identifier was unavailable under sandbox permissions; browser-reported processor count and user agent are in the raw result. Seven paired worker/DOM resets had median 20.5 ms and P95 22 ms. These are local execution measurements, not physiological or learner validation. Both light and dark themes were checked at 320, 390 and 1280 CSS-pixel widths; the 17 checkpoint teaching checks are retained in `benchmarks/results-teaching-browser-learner-checkpoint.json`. No Windows or physical mobile benchmark was performed in this continuation.

## Post-review integration verification, 2026-10-05

Current results-browser.json records nine passing browser checks with seven paired worker/DOM samples (median 18.8 ms; P95 21.6 ms). Current results-teaching-browser.json records 24 learner-interface checks. Both reports include checkpoint, script and source SHA256 provenance; previews were inspected. Results-state-regression.json verifies 24 complete simulation outputs and final patient states against checkpoint ddd3980, with no numerical differences. MODEL_SPEC.md clarifies that ceiling activation and reduced final delivery are distinct, and the ceiling-constrained residual is an algebraic re-solve. These checks do not establish clinical validity or actual learner usability.
