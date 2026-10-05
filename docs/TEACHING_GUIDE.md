# Teaching use and interpretation

ARDS_Sims is intended for supervised education about mechanical responses to controlled ventilator changes. Its current release is not a validated ventilator optimizer. Use the guided comparisons to form a prediction, apply one adjustment, and explain changes in aeration, global elastic pressure, chest-wall contribution, and regional distension together.

The default lesson compares higher and lower recruitability at PEEP 8 then 12 cmH2O, VT 6 mL/kg PBW, RR 20 and PBW 70 kg, with the same seed for both patients. Each comparison starts from the same illustrative initial recruitment state and runs ten breaths. That controls initial state and dwell time, but does not guarantee steady state. The history mode retains recruitment state for a separate hysteresis experiment.

Green describes a higher open fraction; grey describes a lower fraction. Orange marks a within-breath change in aeration. At inspiration, red identifies the assumed high-volume-ratio classification. Neither green nor grey is an outcome score. Map thresholds and opacity are visual categories; their area is not the same as tissue-weighted numeric metrics.

End-expiratory gas volume can rise through recruitment or through expansion of already open units. Higher respiratory compliance and lower driving pressure, at unchanged delivered volume, describe a lower global elastic pressure requirement. They do not exclude regional distension. An increased aerated fraction and an increased distension proxy constitute a model tradeoff; no single metric proves benefit or harm. The distension threshold is illustrative and uncalibrated.

The pressure display explicitly separates end-inspiratory airway pressure, modeled mean pleural pressure, and mean transpulmonary pressure (airway minus mean pleural pressure). It also shows pleural pressure at expiration and inspiration. A higher chest-wall load can increase airway pressure without a proportionate increase in lung distending pressure.

Interpretation text uses qualitative change thresholds of 1 percentage point for tissue fractions and 0.5 cmH2O for driving pressure to distinguish small changes from larger ones in the teaching narrative. These thresholds are not clinical significance cutoffs, measurement uncertainty estimates, or treatment targets. Pressure-limited delivery receives a separate caveat because reduced delivered VT can change the apparent pressure and compliance response.

Metric help is available through keyboard-accessible question-mark buttons. Less immediately useful measures (intratidal aeration gain and perfusion-weighted closed fraction) are under Additional model measures. The latter is not physiological shunt.

## Planned extensions requested by the user

Continuous inspiration/expiration animation, regional airflow and emptying ratios, regional respiratory time constants, and cardiovascular/heart-rate pressure interactions require further model development. They are not implemented in this release. A pressure–volume animation alone would not establish dynamic airway emptying, and recruitment time constants are not equivalent to respiratory R×C time constants. Intravascular pressure must be separated from surrounding pressure and transmural pressure. Changes in heart rate cannot be inferred from respiratory phase alone.

Candidate next implementation: record within-breath regional trajectories; add an explicitly resisted respiratory model with mass-consistent flow and measured emptying; then evaluate a pressure-coupled adult Explain cardiovascular model with its own validation and benchmark. Keep one-way or two-way coupling, cardiovascular parameter assumptions, and the absence of patient calibration explicit. The existing Explain trial and independent review brief support this work.

Sources for model development and pressure interpretation: https://pulse.kitware.com/_cardiovascular_methodology.html ; https://research.utwente.nl/en/publications/mechanical-ventilation-induced-intrathoracic-pressure-distributio/ ; https://www.frontiersin.org/journals/network-physiology/articles/10.3389/fnetp.2023.1257710/full
