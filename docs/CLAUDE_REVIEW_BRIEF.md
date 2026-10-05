# Independent review brief

Requested reviewer: Claude Opus 5.5 with high reasoning, if available in the user's local account. Review is pending; no Claude findings are represented as completed.

Review this project as an adult ARDS educational physiology simulator before public release. Examine `src/engine.js`, `tests/engine.test.mjs`, raw benchmark results, model specification, and the actual UI. Keep scientific assumptions separate from numerical verification and external validation. Do not interpret the passing checks as clinical validation.

Prioritize these potential blind spots:

1. Recruitment kinetics, opening/closing distributions, pressure-history dependence, and whether ten breaths are sufficient for the comparisons shown.
2. The nonlinear open-unit pressure-volume relation, constant resting volume below zero transpulmonary pressure, coupling to a shared chest wall, and pressure floor/ceiling behavior.
3. Whether inspiratory aeration gain is being confused with cyclic recruitment/derecruitment. It measures positive within-breath open-fraction change, not independently measured closure.
4. Whether the EI volume ratio relative to the same unit at TP=5 cmH2O is mislabeled as a validated strain measure. The 1.65 threshold is assumed, and discrete classifications are timestep sensitive.
5. Whether perfusion-weighted closed fraction is being confused with physiological shunt. There is no gas-exchange model and no PaO2/SpO2 output.
6. Root-solver residuals, timestep refinement, pressure-limit delivery, reproducibility, seed variation, and interpretation of increasing random unit count as Monte Carlo resolution rather than spatial mesh convergence.
7. Teaching narrative thresholds, whether compliance improvements conceal distension tradeoffs, and whether the fresh-baseline comparison controls initial state. Worker request ordering, scenario state/history, sweep isolation and stale results, keyboard accessibility, charts and map color semantics.
8. Which public datasets or experiments could genuinely calibrate and validate the model; propose objective endpoints and avoid inventing data.

Return prioritized findings with file/function evidence, impact, proposed repair, and a meaningful verification method. Distinguish must-fix correctness problems from future research improvements. Do not silently replace physiology with cosmetic heuristics. Give a recommendation on educational release readiness and explicitly identify remaining uncertainties.
