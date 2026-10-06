// These are model states, not measured pressures. Airway pressure includes
// resistance in airflow mode and therefore cannot substitute for alveolar pressure.
export function frameReadout(frame,kind,startVolume){
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
    {key:'pes',label:'Esophageal · Pes',value:null,unit:'not modeled',note:'No esophageal balloon or measurement model. Mean pleural pressure is not a substitute for measured Pes.'},
    {key:'palv',label:'Alveolar pressure',value:airflow?null:frame.pressure,unit:airflow?'not computed':'cmH2O',note:airflow?'Regional alveolar pressures differ during flow and are not exported in this view.':'Equals airway pressure in this mode, which has no resistance.'}
  ];
}
