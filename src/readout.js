// These are model states, not measured pressures. Airway pressure includes
// resistance in the flow modes and therefore cannot substitute for alveolar pressure.
export const UNIFIED_KIND='unified-nonlinear-flow';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function frameFlow(frame){
  if(finite(frame?.flow))return frame.flow;
  const q=frame?.unitFlow;if(!q||!q.length)return null;
  let sum=0;for(let i=0;i<q.length;i++)sum+=q[i];return sum;
}
export function frameReadout(frame,kind,startVolume,pleural=null){
  const unified=kind===UNIFIED_KIND,frozen=kind==='frozen-aeration-airflow',airflow=frozen||unified;
  const meanAlveolar=finite(frame.meanAlveolar)?frame.meanAlveolar:null,flow=frameFlow(frame);
  const rows=[
    {key:'external',label:'External body pressure',value:frame.externalPressure??0,unit:'cmH2O',note:'Pressure on the outside of the body (an assumed tank or body-surface pressure). Negative values pull outward on the chest. The chest-load offset is separate.'},
    {key:'drive',label:'Effective pressure drive',value:frame.transrespPressure??frame.pressure,unit:'cmH2O',note:'Airway pressure minus the pressure on the outside of the body. This is the drive that the model pressure limit constrains.'},
    {key:'paw',label:'Airway · Paw',value:frame.pressure,unit:'cmH2O',note:airflow?'Pressure at the airway opening. While air is moving it also includes the push against airflow resistance, so it differs from the pressure inside the airspaces.':'This mode has no airflow resistance, so the airway pressure equals the pressure inside the airspaces.'},
    {key:'ppl',label:'Mean pleural · Ppl',value:frame.meanPleural,unit:'cmH2O',note:'Average pressure around the lung, weighted by tissue. It is a model average, not a measurement. Its absolute value depends on the assumed baseline and on chest-wall recoil.'}
  ];
  if(unified){
    rows.push(
      {key:'pl',label:'Mean lung-distending · PL',value:meanAlveolar===null?null:meanAlveolar-frame.meanPleural,unit:meanAlveolar===null?'unavailable':'cmH2O',note:'Tissue-weighted mean pressure inside the airspaces minus mean pleural pressure: the average pressure across lung tissue. It is a model value. Individual regions differ, and a region’s own value decides whether it opens.'},
      {key:'airwayPl',label:'Airway − pleural',value:frame.pressure-frame.meanPleural,unit:'cmH2O',note:'Airway pressure minus the average pressure around the lung. It includes the push against flow resistance, so it is not the pressure across the tissue while air is moving.'}
    );
  }else{
    rows.push({key:'pl',label:airflow?'Airway − pleural':'Lung-distending · PL',value:frame.pressure-frame.meanPleural,unit:'cmH2O',note:airflow?'Airway pressure minus the average pressure around the lung. It includes the push against flow resistance, so it is not alveolar transpulmonary pressure during airflow.':'Pressure across lung tissue: airway pressure minus the average pressure around the lung (Paw − mean Ppl). It is a model value, not a clinical esophageal-pressure estimate.'});
  }
  rows.push(
    {key:'volume',label:'Lung gas volume',value:frame.volume/1000,unit:'L',note:'Total gas volume in all model regions.'},
    {key:'delta',label:'Volume above breath start',value:frame.volume-startVolume,unit:'mL',note:'Current gas volume minus the gas volume at the start of this recorded breath.'},
    {key:'flow',label:'Airflow',value:airflow&&flow!==null?flow/1000:null,unit:airflow?'L/s':'not modeled',note:'Positive means air entering the lung and negative means air leaving. The still-snapshot (quasi-static) mode has no airflow calculation.'},
    {key:'pes',label:pleural?'Esophageal surrogate · Pes':'Esophageal · Pes',value:pleural?.pesModel??null,unit:pleural?'cmH2O':'not modeled',note:pleural?'A simulated local pressure around the lung at an esophageal level, plus an optional assumed offset. It is not a balloon measurement, device simulation, or whole-lung mean. Its change over the breath matches the whole-lung mean because the assumed gradient is a fixed straight line.':'No local pressure field was recorded for this result.'},
    {key:'plEs',label:airflow?'Airway − Pes surrogate':'PL from Pes surrogate',value:pleural?.plEs??null,unit:pleural?'cmH2O':'unavailable',note:airflow?'Airway pressure minus the simulated local value. It includes the push against flow resistance, so it is not alveolar transpulmonary pressure during airflow.':'Airway pressure minus the simulated local esophageal-level value. Changing the assumed sensor offset changes this estimate without changing the actual regional mechanics.'},
    {key:'pplVentral',label:'Ventral pleural',value:pleural?.pplVentral??null,unit:pleural?'cmH2O':'unavailable',note:'Assumed pressure around the lung at the front (ventral) end of the schematic map, coordinate 0. The gradient is assumed, and the pressure swing over the breath is the same in every region.'},
    {key:'pplDorsal',label:'Dorsal pleural',value:pleural?.pplDorsal??null,unit:pleural?'cmH2O':'unavailable',note:'Assumed pressure around the lung at the back (dorsal) end of the schematic map, coordinate 1. This label stays dorsal in anatomy even when the model is prone.'}
  );
  if(unified)rows.push({key:'palv',label:'Mean alveolar · Palv',value:meanAlveolar,unit:meanAlveolar===null?'unavailable':'cmH2O',note:'Tissue-weighted mean of the pressure inside each region’s airspace. Regions differ while air moves, so this is an average, not one shared pressure.'});
  else rows.push({key:'palv',label:'Alveolar pressure',value:frozen?null:frame.pressure,unit:frozen?'not computed':'cmH2O',note:frozen?'While air is flowing, each region has its own alveolar pressure, so no single global value is shown here. Inspect a region for its modeled value.':'Equals the airway pressure in this mode, which has no airflow resistance.'});
  return rows;
}
