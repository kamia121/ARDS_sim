# Decisions on independent Claude findings

2026-10-05. Claude Opus 5.5 / High performed a read-only source review; a second High consultation critiqued Codex's decisions. Sonnet 5.5 High and Medium then worked on disjoint source/test files. Raw reports, model identities and effort selections are in benchmarks/results-claude-consultation.json. Codex reviewed the changes and made the integration corrections below. No agent's assertion is treated as a test result until checked locally.

| Finding | Decision and implemented outcome |
|---|---|
| D1 baseline race | Accepted. Baseline id/expected config/settings/fresh metadata are fixed when the lesson explicitly starts. A simulation edit during preparation cancels capture and requires an explicit new baseline. Invalidation happens before debounce. Delayed responses cannot become an unintended baseline. |
| D2 interpretation | Accepted. Add aeration-loss explanation, an unequal-delivered-volume caveat above 1 mL, and remove recruitment-benefit claims. Codex additionally prevents equal-volume language when delivery is unknown and removes an unsupported load attribution. The 1 mL absolute tolerance is for displayed interpretation, not a clinical equivalence threshold; its boundary is tested. |
| D3 selected-unit staleness | Accepted. Keep a selected unit id and recompute the text from each accepted result. |
| D4 retained history | Accepted. Clone the last acknowledged state, hold one candidate, and promote only on an explicit acknowledgment. Discarded candidate runs do not enter the accepted history. Codex additionally discards a preceding candidate when a newer valid-id run fails. |
| D5 PV release | Accepted with correction. Instant elastic release changes BOTH pressure and volume, so a proposed vertical PV segment would be incorrect. Separate the existing inspiratory/expiratory paths and label the missing instantaneous release; recording the actual release is next. No loop-area/work calculation exists in this UI. |
| D6 teaching questions | Accepted. Explain how to enter history mode and compare VT, pressure, compliance and regional distension without contradictory wording. |
| D7 naming | Accepted. User-facing measure labels use distension proxy/volume ratio. Internal strainEI/highStrainCutoff field names remain for compatibility; specification disclaimers about conventional strain remain accurate. |
| D8 unit accessibility | Accepted. Add a keyboard-operable numbered-unit input alongside map selection. |
| D9 stale errors | Accepted. Scope compare, sweep and benchmark errors/progress to current request ids; unrelated errors cannot re-enable another active control. |
| D10 artifact provenance | Accepted as a provenance gap, not proof that earlier assertions failed. Re-run current browser scripts; record source/script SHA256 and the pre-integration checkpoint. Captured previews are inspected. |
| D11 pressure ceiling labels | Accepted. Derive displayed ceiling values from embedded result settings. The actual configured default remains 45 cmH2O. |
| D12 residual interpretation | Corrected. The pressure-limited volumeResidual is algebraic self-consistency against the effective target, not independent mass balance. Document this; do not call it a whole-system conservation test. |
| D13 limited sweep points | Accepted. Mark ascending points whose inspiratory ramp activated the ceiling; distinguish ceiling exposure from reduced final delivered VT. |
| D14 sweep top dwell | Keep current numerical behavior. The top PEEP has one ascending and one descending ten-breath exposure; document this deliberate sequential path. No numerical change. |

## Hypotheses and follow-up refinements

H1: limited is an any-inspiratory-step flag, not proof of reduced final delivery. Correct UI and narrative wording now; a systematic search for catch-up scenarios may inform a later split of exposure/delivery fields. No metric values were changed.

H2: the reviewed PBW test followed a query reload at VT 7 and PBW 70, so its starting target was 490 mL; the 560 mL predicate was not ambiguous in that exact sequence. Strengthen it with an increased render counter and the expected result.

H3/H4: nonperiodic end/start states and draw performance belong to trajectory/replay verification. Do not loop an assumed steady-state breath or claim 60-fps performance without measurement. H5 needs a real learner session, which remains pending.

Accepted follow-up: input taxonomy (simulation inputs invalidate, phase/unit/theme views do not); narratives use embedded result settings; explicit UI transition documentation; exact numerical regression against the pre-review commit; safe cloning, fresh candidate acknowledgment and worker-restart tests.

Deferred/rejected follow-up: a worker nonce, protocolVersion and additional state hashes are not needed for the current single-page/single-worker module protocol. Tokens are scoped to that worker lifetime; a new session has no accepted state and requires a fresh reset. Add versioning/nonces before live worker replacement or cross-client state transfer. Stale/duplicate acknowledgments safely return state-ignored rather than becoming user-facing errors. Synchronous workers cannot inspect messages that have not yet been processed; app invalidation and acknowledgment protect accepted history even when obsolete computation still consumes time.

Corrected future scientific details: the emptied fraction is 1-exp(-Te/RC), while exp(-Te/RC) is the remaining fraction. Eigen-time-constant claims must declare resistance, compliance, weighting and coupling conventions. Current meanPleuralEE/EI are tissue-weighted spatial means at their respective snapshots, not cycle averages. Preserve that meaning for cardiovascular pressure forcing; a cycle mean would discard the intended swings.

## Verification

npm test: 12 internal numerical checks, 10 interpretation tests and 10 worker/session tests pass (21 Node test entries because numerical checks share one test-file runner). Twenty-four complete simulation outputs and final states exactly match checkpoint ddd3980 across four phenotypes, two seeds, baseline/PEEP adjustment/pressure-limited settings; raw evidence is in results-state-regression.json. The sole engine-source change is explanatory metadata wording.

Teaching browser: 24 checks, including delayed baseline/config edits, pending-history toggle, stale error filtering, custom-scenario handling, live keyboard unit detail, PV path separation and both themes at 320/390/1280 widths. Existing browser benchmark: nine checks. Provenance hashes and raw timing samples are in their result JSON files. This establishes software behavior and numerical noninterference, not learner or clinical validation.
