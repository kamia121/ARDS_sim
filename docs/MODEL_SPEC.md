# Model specification — reduced adult regional mechanics v1.0.0

The model is illustrative and uncalibrated. It has no gas exchange, cardiovascular feedback, spontaneous effort, airway resistance, inertance, surface-tension energy balance, or CT/EIT geometry. Locations in the maps are schematic; color categories use thresholds that do not directly equal the weighted numeric metrics.

## Equations

For unit i, normalized tissue weight w, open fraction f, dependent coordinate d in [0,1], and transpulmonary pressure T:

`Vopen_i(T) = w_i * [rest_i + capacity_i * max(T,0)/(stiffness_i + max(T,0))]`

`Vtotal = sum_i f_i * Vopen_i(T_i)`

`Ppl_i = baselinePleural + gradient*d_i + Ecw*(Vtotal - VcwReference)`

`T_i = Paw - Ppl_i`

Below zero transpulmonary pressure the constitutive law retains its assumed rest volume. This is a simplification, not a complete collapse law. Recruitment is fractional tissue aeration, not a count of anatomically resolved alveoli.

When T exceeds opening threshold, `f_new = 1-(1-f_old)*exp(-dt*r_open)`. Below closing threshold, `f_new = f_old*exp(-dt*r_close)`. Between thresholds, f is retained. For threshold excess x, `r=x/(3+x)/tau`. Opening/closing thresholds differ, giving state history and time dependence.

The root solver substitutes `z=Paw-baselinePleural-Ecw*(Vtotal-VcwReference)` and T_i=z-gradient*d_i. A safeguarded Newton/bisection solve couples recruitment to pressure or volume each timestep, with at most 45 iterations, primary tolerances 1e-8 cmH2O or 1e-5 mL, and a 0.001 residual failure bound. These are numerical tolerances, not physiological accuracy claims.

## Phenotypes at PBW 70 kg

| Regime | capacity mL | rest mL | stiffness cmH2O | baseline pleural cmH2O | gradient cmH2O | Ecw cmH2O/mL | reference mL | initial f |
|---|---|---|---|---|---|---|---|---|
| high | 4600 | 900 | 17 | 2 | 5 | 0.006 | 1200 | 0.38 |
| low | 4600 | 900 | 17 | 2 | 5 | 0.006 | 1200 | 0.38 |
| wall | 4600 | 900 | 17 | 7 | 5 | 0.013 | 1200 | 0.38 |
| healthy | 3000 | 1500 | 12 | 0.5 | 2 | 0.01 | 2000 | 0.995 |

Mulberry32 provides repeatable sequential random samples. Dependency is uniform [0,1]; raw weights uniform [0.7,1.3] normalized to one; capacity multiplier [0.75,1.25]; stiffness multiplier [0.8,1.2]. Difficult-opening fractions are high/wall 0.08, low 0.68, healthy 0. Ordinary ARDS opening threshold is 6+15U+6d cmH2O; difficult threshold 38+20U; healthy 0.3+3U. ARDS closing threshold is 0.5+6U+3d; healthy -3+2U; always at least 0.5 below opening. Opening tau is 0.35+1.2U seconds; closing tau 1.3+3U. ARDS initial f is clamp(0.38+0.4*(0.5-d)+0.1*(U-0.5),0,1); healthy f=0.995. Perfusion proxy weight is w*(0.5+d). Each U is a newly drawn independent random variate. Volumes/reference scale by PBW/70; Ecw scales inversely. These distributions are assumed, not fitted from cohorts.

## Breathing and state

The UI uses 512 regions, dt=0.1 s and ten breaths per update. Inspiratory volume rises linearly over one third of the cycle; the remaining time is quasi-static expiration at PEEP. Inspiration respects a PEEP pressure floor and a 45 cmH2O ceiling. Unattainable VT is reduced and explicitly reported. There is no dynamic flow waveform or true occlusion maneuver. End-inspiratory quasi-static pressure is displayed as plateau pressure.

The final-breath EE snapshot is taken before inspiration; EI is after inspiration. State stored for the next call is after that breath's expiration. The default guided mode recreates the same seeded initial state for each comparison. Unchecking fresh patients retains state across updates; reset recreates the seed. A copied scenario recreates fresh settings/seeds and omits history. Standard sweeps recreate fresh seeds and carry history through 4–24 cmH2O ascending and descending, ten breaths per step. Ten breaths are not a guarantee of steady state.

## Outputs and interpretation

- EELV: total gas volume at start of final breath. VT: EI volume minus that EE volume.
- Driving pressure: quasi-static EI airway pressure minus PEEP. Crs=delivered VT/driving pressure when the denominator is positive.
- Aerated fraction: sum of tissue weight times EE or EI open fraction.
- Intratidal aeration gain: sum w*max(f_EI-f_EE,0). Internal field `cyclic` is a proxy and does not independently establish the amount of expiratory closure.
- High volume-ratio tissue: sum w*f_EI for units whose fully open EI volume / fully open volume at TP=5 cmH2O exceeds 1.65. This is an assumed distension proxy, not conventional excess strain deltaV/Vref or a validated injury threshold.
- Perfusion-weighted closed fraction: sum w*(0.5+d)*(1-f_EE) divided by total proxy perfusion weight. It is not physiological shunt and predicts no PaO2/SpO2.
- `volumeError`: delivered minus prescribed VT; pressure limitation can make this intentionally nonzero. `volumeResidual`: EI volume minus the final effective solver target. Small residuals establish algebraic consistency, not mass/energy conservation of a whole-body model.

See the benchmark report for measured timestep sensitivity and seed variability. Clinical calibration and external validation remain future work.
