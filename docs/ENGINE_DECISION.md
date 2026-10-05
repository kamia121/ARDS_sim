# Engine comparison and decision

We examined established engines before implementing a regional core.

| Candidate | Strength | Fit for this first release |
|---|---|---|
| Pulse | Established adult whole-body engine; Apache 2.0; detailed respiratory methodology | Strong candidate for future systemic coupling; C++ and coarse respiratory regions add integration work for a regional browser teaching lab |
| Explain | MIT; JavaScript worker architecture; adult whole-body definitions | Practical browser host; stock adult lung is coarsely divided, while its neonatal surfactant controller is not an adult ARDS model |
| BioGears | Apache 2.0 whole-body C++ physiology | Similar integration burden; regional adult ARDS still needs development |
| PRE | Apache 2.0 Python regional research prototype | Useful recruitment ideas; model-specific assumptions and unvalidated outputs require review |
| OpenVentSim | Accessible ventilator teaching interface | Global compliance/template waveforms do not supply the regional recruitment core required here |

## Executed upstream trial

Explain Engine was cloned at commit `c9fdc08c53d624bb9be5d52c66bd6ec145dd6170`. The reproducible trial is `benchmarks/explain-trial.mjs`, with raw results in `results-explain.json`. It initialized the adult model, disabled spontaneous breathing, and enabled volume-controlled ventilation. The adult definition had no neonatal Surfactant recruitment controller. Seven sequential 10-second windows were measured after warm-up.

## Decision

The first release uses an original, reduced regional mechanics core and a module worker. This makes regional recruitment state, equations, and uncertainties inspectable. It does not claim to inherit the validation of Pulse, Explain, or BioGears. Explain remains a possible future host for cardiovascular and gas-exchange coupling after the regional model is reviewed and calibrated. This decision differs from simply extending an existing engine: the executed trial showed that the main required regional adult physiology would still have to be added.

Timing the reduced core against a whole-body engine is not an equal-workload speed competition. Their equations, model counts, and timesteps differ; the benchmark report records these separately.

Sources: https://pulse.kitware.com/_respiratory_methodology.html ; https://github.com/explain-labs/explain-engine ; https://github.com/BioGearsEngine/core ; https://www.frontiersin.org/journals/network-physiology/articles/10.3389/fnetp.2023.1257710/full
