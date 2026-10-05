# ARDS Sim: independent review and plan for the next increment (read-only)

**Scope.** I read the files you listed. I couldn't run `git diff`, so I reviewed the working-tree files, which include the uncommitted learner/theme increment. I did not run `npm test`, the build, or any browser checks. Every claim below comes from reading the code. I also couldn't write the plan file: no Write or ExitPlanMode tool was available in this session, so the plan is below for Codex to evaluate.

---

## 1. Confirmed defects, by priority

**P1: these affect whether the guided comparison is correct**

| # | Defect | Evidence | Impact | Repair | How to verify |
|---|---|---|---|---|---|
| D1 | **The baseline can come from the wrong request.** Each new comparison reassigns the baseline request while a baseline is pending. The response handler drops superseded responses before it checks for the baseline. | `app.js:14` (`if(pendingBaseline)baselineRequest=compareId`); `app.js:151-153` (`if(data.id!==compareId)return` runs before the baseline branch) | If the learner moves a slider or changes phenotype/seed before the baseline returns, that run becomes the baseline. The status line shows only PEEP/VT/RR, so a phenotype mismatch would go unnoticed. If "fresh patients" is unchecked during that window, the baseline comes from a state-retaining run. Nothing stores a fresh flag with the baseline. | Set `baselineRequest` only in `setLessonBaseline`. Handle `data.id===baselineRequest` before the stale-response check. Store `{fresh, config, settings}` with the baseline. Accept it only if fresh and if config/settings match the lesson baseline; otherwise re-request. | Playwright: click Set baseline, then immediately send a PEEP input and change `kind-b`. Assert the recorded baseline equals the lesson baseline. Repeat with the guided checkbox toggled in the pending window. |
| D2 | **The narrative has no derecruitment branch and ignores changes in delivered VT.** | `teaching.js:23-26`. Any aeration change `a≤1` (including large losses) reaches either "little additional aeration" or the generic else. Branch 3 says "consistent with recruitment benefit" from `d<-0.5` without checking that delivered VT is comparable. | Lowering PEEP (the hysteresis teaching question) produces no derecruitment explanation. In free exploration with several changes, the per-patient text can credit recruitment for a lower driving pressure that actually comes from a smaller VT. That contradicts the "multiple controls" warning shown next to it. | Add an `a<-1` branch. When delivered VT differs by more than a stated tolerance, say driving pressure is not comparable and refer to Crs. Consider replacing the word "benefit". | Unit tests in `teaching.test.mjs` for: a PEEP decrease, a VT decrease with a lower driving pressure, and a pressure-limited case. Each asserts the branch text. |
| D3 | **The unit detail panel goes stale.** | `app.js:103` writes `unit-k` only on click. `render()` (`app.js:148`) never refreshes or clears it. | After an adjustment, the panel still shows the baseline run's open fractions as if they were current. | On each new result, clear the panel or recompute it from the selected unit id. | Playwright: select a unit, apply the adjustment, and assert the text matches `ardsResults[i].units[id]`. |

**P2**

| # | Defect | Evidence | Repair / verification |
|---|---|---|---|
| D4 | **In history mode, runs the user never sees still change the patients.** The worker simulates every request (`worker.js:10-12`), but the app discards superseded ones (`app.js:151`). Each discarded run still advances the retained state by 10 breaths. | Use a state token. The app sends the id of the last result it accepted. The worker clones that state, simulates, and keeps tentative states keyed by request id (dropping older ones). Verify with a node test of the worker handler: send N rapid requests and accept only the last. The final state must equal one sequential run along the accepted chain. |
| D5 | **The PV chart draws a false deflation slope.** `line()` joins the last inflation point (Pplat) to the first deflation point (PEEP) with a straight diagonal (`app.js:125-135`, `engine.js:159-164`). That looks like a pressure-volume deflation path the model never computes. | Draw the release as a separate dashed vertical segment labelled "instantaneous in this quasi-static model". The trajectory work below adds the post-release frame this needs. |
| D6 | **Two teaching questions are incoherent.** "Increase tidal volume. Does a lower driving pressure…" is contradictory, because more VT raises driving pressure (`index.html:54`). The "Return PEEP… pressure history" question can't be answered in the default fresh-patient mode and doesn't say to switch modes. | Rewrite both. The hysteresis question should tell the learner to uncheck "Fresh patients". |
| D7 | **"Strain" wording contradicts the spec.** The spec says the measure is not strain, but the UI calls it "high strain" in places: `app.js:98, 146, 158`, the `index.html:53` aria-label, `:54`, `:62`, `:70`. AGENTS.md requires consistent labels. | Use "distension proxy" / "volume ratio" throughout. Add a Grep-based test that fails on "strain" in user-visible strings. |
| D8 | **Unit inspection needs a mouse.** Only a `click` listener exists (`app.js:100`), and the canvases have no tabindex or keyboard alternative (`index.html:41-42`). | Add a keyboard-operable unit selector, for example a numeric "Unit" input or arrow-key navigation with a visible focus ring. |

**P3**

- **D9.** Error messages aren't checked against the request id (`app.js:164-166`). An error from a stale request can overwrite the status line or re-enable the Sweep button while a sweep is still running.
- **D10.** The current teaching browser script writes `preview-teaching-{theme}-mobile-top.png` (`teaching-browser.mjs:58`). No such file exists, and it isn't gitignored. So `results-teaching-browser.json` was probably produced by an earlier version of the script. "Browser checks pass" isn't backed by artifacts from the current script. Re-run and record before claiming it.
- **D11.** 45 cmH2O is hardcoded in `app.js:11, 36, 152`. Derive it from `result.settings.pressureLimit`.
- **D12.** `volumeResidual` checks nothing in pressure-limited breaths. It compares the solved volume with a re-solve at the same pressure (`engine.js:154`). Document that.
- **D13.** The sweep chart ignores the `limited` flag on each point (`app.js:140-145`). Mark pressure-limited points.
- **D14.** These two are code behaviour that needs a decision rather than definite bugs:
  - `sweep()` validates `initialState` after using it (`engine.js:187-188`). Harmless, because it throws either way.
  - The descending sweep starts by running the top PEEP for another 10 breaths (`engine.js:190`), so the top point gets a double dwell. Either document it or skip the repeat.

## 2. Hypotheses (not verified, each needs a check)

- **H1.** `limited` is set if any step of the final breath hits the ceiling (`engine.js:148`). If recruitment at 45 cmH2O lets later steps catch up to the volume ramp, the result could show `limited=true` with `volumeError≈0`. The UI would then report a delivery limitation that didn't happen. Test: scan phenotypes, seeds and limits; assert `limited ⇒ volumeError < -tol`, or split the flag into `ceilingReached` and `deliveryReduced`.
- **H2.** The browser check at `teaching-browser.mjs:66-67` waits for `targetVT===560`. 560 is both 8×70 and 7×80, so the predicate may not be tied to the PBW change. Wait for an increment of `ardsRenderCounter` instead.
- **H3.** After 10 breaths, the end of the displayed breath (`units[].state`) can differ from its start (`openEE`). A looping animation would then jump at the wrap. This needs measuring for each lesson.
- **H4.** `drawMap` resizes the canvas and recomputes positions on every call (`app.js:79-83`). At 60 fps with 2×512 units this may miss the frame budget on slower devices. Measure it rather than assume.
- **H5.** In the volume lesson, A and B are identical (same phenotype and seed). Learners may find the duplicate panel confusing; this is a question for the learner session.

## 3. Critique of the proposed increment, by the topics you asked about

The direction is sound. Capture the actual computed regional states from the final breath, not tweened endpoints. Keep metric definitions unchanged during this increment.

- **Instantaneous expiratory pressure drop.** At the start of expiration, the model drops pressure to PEEP and the volume falls in zero time, because there is no resistance. The engine should record a separate "release" frame at `t = ti`: solve at PEEP with `dt=0` and don't commit, so the open fractions stay at their end-inspiration values. This separates two things:
  - the instantaneous elastic recoil, which is an artifact of having no resistance;
  - the time-dependent closing kinetics that follow.

  Playback must never interpolate across the release. Show it as a step, labelled "instantaneous in this model; resisted emptying is not modelled".
- **Frame timestamps.** The inspiration step is `ti/ceil(ti/dt)` and the expiration step is `te/ceil(te/dt)`. Neither equals `dt` in general (at RR 13, for example). Record a `times` array and drive playback from it, not from index×dt. The end-inspiration and release frames share a timestamp. Times are relative to the start of the displayed breath; absolute time is `totalElapsed − cycle + t`. Show model time and playback speed separately.
- **What "end expiration" means.** EELV, `openEE` and the map's "End expiration" are the start of the displayed breath. The last frame is the state after this breath's expiration, which is what history mode carries forward. Label both. Report a breath-to-breath change (Σw·|f_last−f_0| and ΔV) as a numerical steady-state indicator, not as physiology. The existing EE/EI buttons should map to frame 0 and the end-inspiration frame.
- **Pressure ceiling.** Record a per-frame `ceilingActive` flag, resolve H1, and annotate frames where the ceiling is active. Separately, there's an optimisation: the code currently solves the ceiling on every inspiratory step. Solving the volume first and switching to the ceiling only when pressure exceeds it is equivalent by monotonicity. Do this only with a regression test, and not in the same commit as the trajectory work.
- **Map semantics during animation.** Keep the definitions. Fill opacity/radius should follow per-frame f (or v). Orange is a property of the whole breath, so show it as a fixed ring. Red stays defined at end inspiration only; show it on that frame. Changing it to a per-frame classification would be a model change that needs spec and test updates.
- **Worker races.** D1, D4 and D9 above. Animation state must be tied to the accepted response id. A new result replaces the trajectory, keeps the paused/playing state, and resets to frame 0 (or the nearest phase).
- **Memory and performance.**
  - Record only the final breath, and only when asked (`record:'lastBreath'`). Sweeps stay off.
  - Size: frames = ni+ne+2, which is 23 at RR 30, 32 at RR 20 and 53 at RR 12. At 512 units with f and v in Float64, that's about 0.43 MB per patient at RR 12.
  - Float64 is recommended so tests can check exact equality with the `units[]` fields.
  - Add a hard guard on frames×units (e.g. ≤ 250k) because the engine accepts RR down to near 0 and up to 10,000 units.
  - Send the buffers in the `postMessage` transfer list.
  - Leave trajectories out of `baseline = structuredClone(...)`.
  - Cache map positions per canvas size and resize only on resize events.
  - Run no `requestAnimationFrame` loop while paused, hidden (`visibilitychange`), on another tab, or with reduced motion.

## 4. Sequenced plan with acceptance criteria

**Step 0 (Codex).** Accept or reject the findings above. Then fix three interfaces before any parallel work:
- the trajectory schema;
- the worker message schema (`stateToken`, id-scoped errors);
- the playback API.

**Increment A: defect fixes (its own commit).** Covers D1–D9, D11 and D13, plus resolving H1 and H2.
- The new race tests pass: Playwright for D1 and D3, a node test of the worker handler for D4.
- New `teaching.test.mjs` cases cover derecruitment, ΔVT and the pressure-limited case.
- The "strain" Grep test passes, and the map unit selector works by keyboard.
- `npm test` and `npm run build` pass. Both browser scripts are re-run on the current scripts, and the artifacts are committed (closes D10).
- No change to any engine metric value. Check by deep-equality on fixed seeds before and after.

**Increment B: trajectory capture in the engine.** No physiology change.

`simulate(..., {record:'lastBreath'})` returns:
- `times`, `pressure`, `volume`, `z` (all Float64, length F);
- `phase` (Uint8: start / inspiration / release / expiration);
- `ceilingActive`;
- `f[F·N]` and `v[F·N]`;
- `ti`, `cycle`, `releaseIndex`, and `kind:'quasi-static-steps'`.

Tests:
1. Metrics, `pv` and `units` are identical with recording on and off, and the patient state afterwards is identical too.
2. Frame 0 equals `openEE`/`volumeEE`; frame `ni` equals `openEI`/`volumeEI`; the last frame equals `units[].state`.
3. For every frame, Σv equals `volume` within 1e-6 mL.
4. `times` is non-decreasing and ends at `cycle`; only `ti` repeats; the release frame has end-inspiration f and pressure = PEEP.
5. Pressure stays at or below the limit, and `ceilingActive` agrees with the limit.
6. The analytic linear compartment gives the expected release volume.
7. The size guard throws a RangeError.

Also:
- Recording overhead is measured. Target: no more than +10% median for 512 units × 10 breaths on the same machine, with raw samples recorded.
- MODEL_SPEC.md gets a "Trajectory output" section that states plainly: no interpolation in the engine, the release is instantaneous, and this is not a resisted-flow solution.

**Increment C: playback UI.**
- `src/playback.js` is a pure module with frame lookup, interpolation that never crosses the release, and a play/pause/step state machine. It has node tests:
  - computed frames are returned exactly;
  - interpolation is never applied across `releaseIndex`;
  - mapping from playback time to model time is monotone.
- Controls:
  - a Play/Pause button with `aria-pressed`;
  - previous/next frame buttons;
  - a range scrubber whose `aria-valuetext` gives model time and phase;
  - the existing EE/EI presets;
  - selectable playback speed (labelled).
- Default is paused at end expiration (WCAG 2.2.2). The live region announces only on pause or step.
- Under `prefers-reduced-motion` (and with an in-app toggle): no autoplay and no tweening; stepping/scrubbing shows discrete computed frames only. Playwright with `emulateMedia({reducedMotion:'reduce'})` asserts a rAF counter stays constant.
- Pause and hidden tab stop rAF; the counter is stable over 500 ms.
- The PV chart gets a cursor and a dashed release segment (closes D5).
- A visible label separates the display interpolation from physiology.
- No overflow at 320/390/1280 in both themes.
- Per-frame draw time (median/p95) for both maps is recorded in `results-browser.json`.

**Then: supervised learner session (people, not code).** Record misunderstandings before claiming usability.

**Later increment D: resisted filling and emptying.** Acceptance criteria:
1. **Analytic single compartment.** Passive exhalation V₀e^(−t/RC), constant-flow inspiration P = PEEP + RQ + V/C, and pressure-control rise C·ΔP(1−e^(−t/RC)). Relative error below a stated bound, and the observed convergence order matches the integrator across dt halvings.
2. **Mass balance.** Each step, Σ regional flow equals airway flow and the integral equals ΔV within 1e-9 relative. At periodic steady state, inhaled VT equals exhaled VT, and trapped volume is reported as EELV drift.
3. **Chest-wall coupling.** For N identical units with a shared chest wall, the eigenvalues are −(E+N·Ecw)/R (common mode) and −E/R (N−1 modes). This shows local R×C ≠ network time constants.
4. **Heterogeneous regions.** A two-compartment Otis case shows pendelluft during an occlusion with zero net airway flow.
5. **Pressure limits.** Airway pressure never exceeds the limit.
6. **Stiffness.** Stable for dt > smallest τ (implicit scheme).
7. **Quasi-static limit.** As R→0, the results converge to the current model's metrics.
8. **One explicitly named emptying ratio.** For example, a unit's (V_EI−V_end)/(V_EI−V_start), tested against e^(−Te/RC).
9. **Separate fields.** Respiratory R×C time constants are reported separately from the recruitment opening/closing time constants.

**Later increment E: evaluate an adult cardiovascular engine before coupling.**
1. Explain or Pulse runs alone: adult baseline within cited reference ranges (stated as a reference, not validation), blood-volume conservation, steady state.
2. Then one-way forcing with the recorded mean pleural trajectory, which increment B makes available through `z`.
3. Test: a quasi-static step in surrounding pressure moves intravascular pressure while transmural pressure is initially unchanged. Verify the upstream `pres_tm` semantics rather than trusting the field name. Run with reflexes on and off.
4. Show heart rate only when it's an output of the engine's own dynamics.
5. Document the one-way coupling. Two-way coupling is deferred. Don't infer preload from CVP.

## 5. Recommended next coding increment

**A, then B+C as one increment with separate commits for B and C.** Fix D1–D4 first. Animation built on a race-prone, mislabelled comparison would make those defects harder to see. B needs to land with its tests before any UI uses it.

## 6. File ownership (non-overlapping at any one time; interfaces fixed in Step 0)

| Owner | Files |
|---|---|
| **Sonnet 5.5 High: engine/numerics** | `src/engine.js`, `tests/engine.test.mjs`, `docs/MODEL_SPEC.md` (trajectory and metric-semantics sections), `benchmarks/engine-benchmark.mjs`, `benchmarks/results-engine.json` |
| **Sonnet 5.5 High: concurrency/playback core** | `src/worker.js`, new `src/session.js` (testable worker handler with state tokens), new `src/playback.js`, new `tests/worker.test.mjs`, new `tests/playback.test.mjs` |
| **Sonnet 5.5 Medium: UI/teaching** | `src/app.js`, `index.html`, `styles.css`, `src/teaching.js`, `tests/teaching.test.mjs`, `docs/TEACHING_GUIDE.md`, `benchmarks/teaching-browser.mjs`, `benchmarks/browser-benchmark.mjs` |
| **Codex: integration** | `docs/CODEX_NEXT_TASK.md`, `docs/CLAUDE_COLLABORATION_BRIEF.md`, `docs/BENCHMARK_REPORT.md`, `README.md`, the accepted/rejected findings log, running all checks, and committing browser results/previews |

`npm test` already picks up `tests/*.test.mjs`, so `package.json` doesn't need changing. Please confirm the actual model identity each collaborator returns, as the brief requires.

## 7. Decisions for Codex

1. Float64 vs Float32 trajectory arrays (I recommend Float64).
2. Whether to keep the double dwell at the top PEEP in sweeps.
3. Whether to split `limited` into two flags, pending H1.
4. Wording that replaces "recruitment benefit".
5. Learner session after A, or after C (I recommend after C).

None of these numerical or browser checks is clinical validation. Nothing here identifies a patient's best ventilator setting.
