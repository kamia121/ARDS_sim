# ARDS Sim development plan

Agreed sequencing after the 2026-10-05 Claude Opus 5.5 / High consultation and Codex's critical follow-up. The independent report and follow-up are retained in CLAUDE_OPUS_REVIEW.md and CLAUDE_OPUS_FOLLOWUP.md; accepted changes and corrections are recorded in CLAUDE_REVIEW_DECISIONS.md. The source review is not clinical validation or a supervised learner session.

## Completed foundation

ARDS Sim branding and VA_coupling_sim theme parity; lesson objectives, prediction/reflection prompts, setting/output/mechanism/tradeoff explanations; comparison request and baseline safeguards; acknowledged retained-state simulations; derecruitment and unequal-volume interpretation; current keyboard-accessible unit inspection; separate inspiratory and expiratory PV paths and pressure-ceiling sweep annotations. No physiological equations changed.

Sonnet 5.5 / High implemented the worker/session service and isolated tests; Sonnet 5.5 / Medium implemented interpretation text and isolated tests. Codex integrated, critically revised, verified and committed the work. Exact model identities and CLI effort selections are recorded with reports in benchmarks/results-claude-consultation.json.

## Next increment: computed breath trajectories, then replay

Freeze the trajectory schema before assigning collaborators. Record only the final breath, optionally, using Float64 arrays in stable unit order. Include actual timestamps, phase/segment boundaries, airway pressure, total volume, the common transpulmonary-pressure offset, per-unit open fraction and gas volume. Derive tissue-weighted spatial mean pleural pressure at each time from the offset and dependent gradient; do not replace this waveform with a cycle average.

Capture the before-inspiration snapshot, each committed inspiratory step, end inspiration, an explicit zero-time elastic release at the same time as end inspiration, and each existing expiratory update. Recording must not change existing metrics, PV points or carried patient state. Solve the release at dt=0 without committing state or changing the existing solver guess. Elastic release changes both gas volume and pressure; no smooth resisted-emptying curve may be invented.

Acceptance: exact recording-on/off noninterference; frame endpoint equality with existing regional/summary outputs and final carried recruitment; regional gas-volume sums; timestamp and pressure bounds; analytic fixed-open elastic reference; pressure-ceiling scenarios; serialization/transfer and bounded payload behavior; raw recording-overhead measurements and timestep sensitivity. Explicitly separate start-of-breath expiration from final expiration, which can differ before steady state. The optional recording guard must report overflow rather than silently truncate.

Implement one stored-breath replay, paused initially, with Play/Pause, discrete frame steps, keyboard scrubber, start-expiration/end-inspiration/final-expiration inspection and model-time readouts. Summary metrics keep their current definitions; selected-frame values are separate. No interpolation across the release discontinuity. Any other display interpolation must be labelled visual interpolation between computed quasi-static states. Honor reduced motion, hidden-page/tab pause and replacement by new results. Do not imply looping a stored breath is continued physiological simulation. Cache map geometry and measure draw times before claiming smooth performance. Keep orange as a breath-level aeration-change indicator and red as the existing end-inspiratory distension classification unless a separately reviewed definition change is made.

Suggested parallel ownership once interfaces are fixed: numerical/trajectory instrumentation and reference tests with Sonnet High; replay core/worker transfer tests with Sonnet High; bounded UI controls/styles with Sonnet Medium; Codex owns integration, specification consistency and final checks. Do not allow agents to write the same files concurrently.

## Supervised learner review

After the replay increment, ask a learner to predict, apply and explain each scenario without coaching. Record whether the changed control, model mechanism, delivered-volume comparability and regional tradeoff are understood. Observe whether identical A/B panels in the tidal-volume lesson help or confuse. Automated checks do not establish usability; learner review remains pending.

## Later: resisted regional filling and emptying

Specify regional resistance, gas-volume state and chest-wall coupling before UI outputs. Validate against explicitly defined linear-compartment references, mass balance, timestep refinement, pressure constraints, heterogeneous scenarios and limiting behavior. Distinguish recruitment opening/closing kinetics from respiratory R×C estimates and network eigen-time constants; define the physical weights and coupling conventions before using any eigenvalue formula.

Choose and name the emptying ratio. In a fixed-compliance linear reference, the fraction remaining above the expiratory equilibrium is exp(-Te/RC); the fraction emptied is 1-exp(-Te/RC). These are different quantities. Define how recruitment and moving equilibrium volumes affect the eventual regional measure before displaying it. No airway-flow or air-trapping output is present in the current model.

## Later: cardiovascular engine evaluation and coupling

Evaluate a pinned developed adult engine (Explain or Pulse) independently before adding coupling. Verify surrounding-pressure bookkeeping and upstream transmural-pressure fields, volume conservation, numerical stability and reflex behavior. Initial coupling should explicitly state its one-way respiratory pressure forcing and native-lung simplifications. Surrounding, intravascular and transmural pressures remain distinct; heart rate must come from implemented engine dynamics. No patient-treatment recommendations or inherited validation claims.

Expanded physiology needs its own model specification, numerical sensitivity, integration tests, hardware/runtime/date/raw benchmarks on the intended Mac and Windows devices, and an independent review of the implemented expansion.
