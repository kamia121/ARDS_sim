// These are model states, not measured pressures. Airway pressure includes
// resistance in airflow mode and therefore cannot substitute for alveolar pressure.
export function frameReadout(frame,kind,startVolume,pleural=null){
  const airflow=kind==='frozen-aeration-airflow';
  return [
    {key:'external',label:'External body pressure',value:frame.externalPressure??0,unit:'cmH2O',note:'Assumed tank/body-surface pressure. Negative values act outside the chest; chest-load offset is separate.'},
    {key:'drive',label:'Effective pressure drive',value:frame.transrespPressure??frame.pressure,unit:'cmH2O',note:'Airway minus external body pressure. This is the drive constrained by the model pressure limit.'},
    {key:'paw',label:'Airway · Paw',value:frame.pressure,unit:'cmH2O',note:airflow?'Airway-opening pressure includes resistance.':'No resistance in this mode; airway and alveolar pressure are equal.'},
    {key:'ppl',label:'Mean pleural · Ppl',value:frame.meanPleural,unit:'cmH2O',note:'Tissue-weighted model mean. Absolute pressure depends on the assumed pleural baseline and chest-wall recoil.'},
    {key:'pl',label:airflow?'Airway − pleural':'Lung-distending · PL',value:frame.pressure-frame.meanPleural,unit:'cmH2O',note:airflow?'Paw − mean Ppl includes resistance and is not alveolar transpulmonary pressure during flow.':'Model mean transpulmonary pressure = Paw − mean Ppl; not a clinical esophageal-pressure estimate.'},
    {key:'volume',label:'Lung gas volume',value:frame.volume/1000,unit:'L',note:'Total model gas volume in all regions.'},
    {key:'delta',label:'Volume above breath start',value:frame.volume-startVolume,unit:'mL',note:'Current gas volume minus the start of this recorded breath.'},
    {key:'flow',label:'Airflow',value:airflow?frame.flow/1000:null,unit:airflow?'L/s':'not modeled',note:'Positive enters the lung; negative leaves. The quasi-static mode has no airflow calculation.'},
    {key:'pes',label:pleural?'Esophageal surrogate · Pes':'Esophageal · Pes',value:pleural?.pesModel??null,unit:pleural?'cmH2O':'not modeled',note:pleural?'Assumed local pleural pressure at an esophageal level, plus an optional assumed offset. This is not a balloon measurement, device simulation, or whole-lung mean.':'No local pressure field was recorded for this result.'},
    {key:'plEs',label:airflow?'Airway − Pes surrogate':'PL from Pes surrogate',value:pleural?.plEs??null,unit:pleural?'cmH2O':'unavailable',note:airflow?'Paw minus the local surrogate includes resistance and is not alveolar transpulmonary pressure during flow.':'Paw minus the simulated local surrogate. An assumed sensor offset changes this estimate without changing actual regional mechanics.'},
    {key:'pplVentral',label:'Ventral pleural',value:pleural?.pplVentral??null,unit:pleural?'cmH2O':'unavailable',note:'Assumed pleural pressure at the schematic ventral end (coordinate 0). The gradient is assumed and tidal pressure swing is uniform across regions.'},
    {key:'pplDorsal',label:'Dorsal pleural',value:pleural?.pplDorsal??null,unit:pleural?'cmH2O':'unavailable',note:'Assumed pleural pressure at the schematic dorsal end (coordinate 1). This anatomical label stays dorsal when prone.'},
    {key:'palv',label:'Alveolar pressure',value:airflow?null:frame.pressure,unit:airflow?'not computed':'cmH2O',note:airflow?'Regional alveolar pressures differ during flow. Inspect a region for its modeled alveolar pressure; no single global value is shown here.':'Equals airway pressure in this mode, which has no resistance.'}
  ];
}
