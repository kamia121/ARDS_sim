# Comparison protocol and UI transitions

Single app page and one module worker. IDs are increasing numeric generations scoped to that worker lifetime. App and worker ship in the same static artifact; live worker replacement and cross-client state transfer are unsupported.

## Messages

`compare`: `{id, type:'compare', config:[{kind,seed,pbw},...], settings:{peep,vt,rr,pressureLimit}, reset:boolean, baseStateToken:number|null}`.

The session clones the last acknowledged patients for retained comparisons, requiring matching config and base token. Fresh comparisons construct new seeded patients and ignore the predecessor token. Both become tentative candidates. At most one accepted state and the newest candidate are retained. A newer increasing-id compare discards the previous candidate, including when its own settings/config later fail; accepted state is unaffected.

`compare` result: `{id,type:'compare',config,settings within results,results,modelInfo,stateToken:id}`. The UI checks id, exact captured config, current config and captured/current settings before displaying it. Narratives use embedded result settings/metrics. The UI posts `{id:stateToken,type:'accept-state'}` before later comparison requests. The worker promotes only the matching newest candidate and returns state-accepted; stale/duplicate acknowledgments return state-ignored without changing history.

`error`: `{id,type:'error',requestType,message}`. Only a current request for that operation may update its status/control. Benchmark progress is also id-scoped. Sweep and benchmark do not access the comparison session's accepted state.

A worker restart has no accepted token; a retained request fails rather than silently reusing unrelated history. Fresh Reset patients recovers through the same candidate/acknowledgment protocol.

## UI transitions

| State | Behavior |
|---|---|
| Custom scenario / no baseline | Simulate supplied settings from fresh patients; guided adjustment disabled until Set baseline. |
| Baseline pending | Immutable expected lesson/config/settings/fresh metadata; guided adjustment disabled. Any simulation edit cancels capture and requires explicit Set baseline again. |
| Baseline ready | Only the matching fresh lesson result is recorded; guided adjustment enabled. |
| Comparing | Clear prior narratives immediately; retain a valid recorded baseline. Accept only the current settings/config result. |
| Comparison ready | Render actual deltas, settings, mechanism and tradeoff from accepted snapshots; unit details refresh. |
| Configuration invalidated | Disable guided adjustment and discard baseline; simulate fresh patients for changed phenotype/seed/body size. |
| Setting edited | Invalidate the response generation before debounce; preserve a completed same-config baseline. |
| History mode | Another ten-breath run uses acknowledged retained state when available; no controlled-comparison narrative. |
| Current error | Show operation-specific error; baseline adjustment is disabled for compare errors. A fresh reset or explicit lesson baseline can recover. |

Simulation inputs: PEEP, VT, RR, PBW, phenotype, seed, lesson, history/fresh mode, and reset/new seeds. These invalidate a pending comparison. Unit number, map phase, theme and workspace tabs are view inputs; they do not alter recruitment state or baseline validity. Existing tests exercise delayed baseline/config/history transitions, stale errors and view-only preservation.
