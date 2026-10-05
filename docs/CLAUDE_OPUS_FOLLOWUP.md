**Yes, A first is correct.** Every later increment relies on comparisons and narratives being bound to the right state, so A has to land first. Your corrections are right. In particular, I accept the RC correction: (V_EI − V_end)/(V_EI − V_start) is the emptied fraction, 1 − exp(−Te/RC). My example had it backwards.

Below are targeted refinements, followed by the omissions I'd treat as serious before freezing.

## Concurrency contract refinements

1. **Freeze the message schema first, in its own commit.** Three agents are working on interlocking pieces: worker state, narratives and UI. Commit the typed message and result shapes before any parallel work starts:
   - compare / accept-state / result / error / ack-confirmed
   - each carrying `protocolVersion`
   
   Otherwise each agent will invent edge semantics separately.
2. **Make tokens non-reusable.** Use a monotonic generation counter plus a hash of `(reset, config)`, not just the result id. A worker restart must invalidate every outstanding token, so add a worker-instance nonce. Anything carrying an old nonce then becomes an id-scoped error that requires a fresh run.
3. **Route fresh runs through the same candidate→accept path.** "Ignores predecessor tokens" should only mean "has no base". If fresh results are promoted implicitly, you have two promotion paths, and that is where silent retention bugs come back.
4. **Explicitly reject these acknowledgement cases:**
   - acknowledging a candidate that was superseded
   - double acknowledgement
   - acknowledgement after reset
   
   Each should produce an id-scoped error and leave accepted state untouched. A worker exception mid-simulation discards the candidate and never touches accepted state.
5. **Plan for stale compute.** Synchronous simulations can't be interrupted, so a stale compare still burns its full duration. That's acceptable in A, but the handler should check the generation before posting and drop stale results itself. The app filter then becomes a second line of defence rather than the only one.
6. **Pin the clone semantics.** Use a deep clone that includes typed arrays and any RNG or seed state. Add a noninterference test: compare-from-clone must equal the same sequence replayed from a fresh run, bit for bit at Float64.
7. **Test the pure handler with adversarial sequences.** Include out-of-order acknowledgement, a stale base token, reset during a pending candidate, baseline-pending followed by user input, and worker restart. Inject ids and clock so tests are deterministic.

## Serious omissions

**A. Input taxonomy.** "Invalidate on input change" needs an explicit list separating simulation inputs from view-only inputs:
- Simulation inputs (invalidate): settings, config, lesson, reset.
- View-only inputs (do not invalidate): D3 selected unit, D8 keyboard focus, chart toggles.

Without the list, the D3 live unit details either wrongly kill comparisons or, worse, someone wires selection into the request.

**B. Narratives must consume only the result's embedded settings snapshot,** never live UI state. Every result should carry the exact config and settings it was computed from. Narratives and metric interpretations render from that snapshot alone. Otherwise text can describe settings that differ from the displayed comparison during the debounce window. That window is exactly the stale-display bug D9 targets, re-entering through prose.

**C. Write an explicit UI state machine.** Enumerate the states: idle, baseline-pending, baseline-ready, comparing, compare-ready, invalidated and error. Specify which controls are enabled in each, and test the transitions. "Invalidated baselines disable the guided adjustment" is one row of that table; the other rows need defining too.

**D. Enforce "numbers unchanged in A" mechanically.** Use a golden test over the benchmark numeric fields. Keep it separate from labels and classification text, because the D2 derecruitment branch will legitimately change labels. Labels then change only through reviewed diffs, while numbers can't drift silently. Commit the current untracked `benchmarks/results-claude-consultation.json` and review doc first, so the golden baseline and provenance are pinned.

## D2 / D13 tolerances

For the D2 tolerance:
- State it as absolute plus relative, with units, in one named constant.
- Add tests on both sides of the boundary.

For D13, ceiling exposure needs its own defined threshold. It can reuse the D2 tolerance, but only if you say so. Don't let a different epsilon appear inline.

## D5 and the trajectory contract

Disconnecting the inflation and expiration paths is the right interim fix. Check two things:

1. Does any existing code compute loop area, hysteresis or work over the PV path? If so, it is now computing over a gap and must be disabled or annotated.
2. The legend and ARIA text must not imply a closed loop.

For B, duplicate timestamps at EI and release will break any consumer that assumes strictly increasing time: binary-search lookup, finite-difference derivatives, and chart libraries that dedupe x. Specify three things:
- Consumers index by segment and frame, not by time.
- The release discontinuity is an explicit segment boundary in the data, not something inferred from equal timestamps.
- When the payload guard trips, recording is dropped with a flagged reason, never truncated silently.

Use transferable buffers for the Float64 frames.

## Process notes

For D10, record each artifact with the commit hash and the script hash so provenance is checkable later.

D12, D14 and H2 are fine as stated. For the cardiovascular coupling, I agree with your correction. One addition: "mean" should mean averaged over the breath cycle, and the sign convention for the dependency gradient should be stated once, in a single place.

*Per your instruction I made no tool calls, so I didn't write a plan file or exit plan mode.*
