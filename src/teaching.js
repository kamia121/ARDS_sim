export const LESSONS = {
  recruitment: {name:'PEEP and recruitability',kinds:['high','low'],baseline:{peep:8,vt:6,rr:20,pbw:70},adjustment:{peep:12},instruction:'Compare the same PEEP increase in lungs with different assumed opening thresholds. Look for aeration gain, driving-pressure change, and increased regional distension.'},
  wall: {name:'Chest-wall pressure',kinds:['high','wall'],baseline:{peep:8,vt:6,rr:20,pbw:70},adjustment:{peep:12},instruction:'These patients share the same seeded lung assumptions. Patient B has greater chest-wall load. Compare airway pressure with mean transpulmonary pressure; airway pressure alone cannot separate lung from chest-wall load.'},
  volume: {name:'Tidal volume and regional distension',kinds:['high','high'],baseline:{peep:8,vt:6,rr:20,pbw:70},adjustment:{vt:8},instruction:'Use identical seeded lungs and raise tidal volume from 6 to 8 mL/kg PBW. Observe delivered volume, driving pressure, and the fraction above the assumed distension threshold.'}
};
export const METRIC_HELP = {
  eelv:'Gas volume remaining at expiration. It can rise because more tissue aerates or because already aerated units expand. A higher value alone does not establish benefit.',
  pplat:'Quasi-static end-inspiratory airway pressure. It includes both lung and chest-wall loads. This model does not perform a clinical inspiratory-hold measurement.',
  dp:'Plateau pressure minus PEEP. At the same delivered tidal volume, a lower value means a lower global elastic pressure requirement. Regional distension may still increase.',
  crs:'Delivered tidal volume divided by driving pressure. Higher compliance means more volume per unit of elastic pressure in this model; it does not prove a safer setting.',
  openEE:'Tissue-weighted aerated fraction at expiration. An increase means more of the assumed tissue remains open. It does not predict oxygenation or clinical outcome.',
  cyclic:'Positive change in open fraction from expiration to inspiration. It can indicate within-breath recruitment, but this snapshot comparison does not independently measure expiratory closure or injury.',
  over:'Aerated tissue above an assumed fully open volume ratio of 1.65 relative to that unit at transpulmonary pressure 5 cmH2O. This is a distension proxy, not a validated injury cutoff.',
  closedPerfusion:'Closed tissue weighted by an assumed dependent perfusion gradient. This is a proxy only; it is not physiological shunt or an oxygen-saturation prediction.'
};
const signed=(v,n=1)=>`${v>=0?'+':''}${v.toFixed(n)}`;
export function explainComparison(before,after){
  const a=(after.openEE-before.openEE)*100,d=after.dp-before.dp,h=(after.over-before.over)*100;
  const compliance=Number.isFinite(before.crs)&&Number.isFinite(after.crs)?` compliance ${signed(after.crs-before.crs)} mL/cmH2O;`:"";
  const changes=`Aerated tissue ${signed(a)} percentage points; driving pressure ${signed(d)} cmH2O;${compliance} distension proxy ${signed(h)} percentage points.`;
  let meaning;
  if(a>1 && h>1)meaning='More tissue is aerated, while more aerated tissue also crosses the assumed distension threshold. This is a recruitment–distension tradeoff.';
  else if(a<=1 && h>1)meaning='There is little additional aeration, while the distension proxy increases. In this model, the adjustment mainly adds load to the aerated lung.';
  else if(a>1 && d<-.5 && h<=1)meaning='More tissue aerates and the global elastic pressure requirement falls, with little change in the distension proxy. These mechanical changes are consistent with recruitment benefit within this model.';
  else meaning='The metrics change in different ways or only slightly. Assess aeration, delivered volume, elastic pressure and distension together rather than judging one number alone.';
  if(after.limited)meaning+=' The pressure ceiling limits delivered tidal volume, so compliance and pressure changes must be interpreted with the reduced delivered volume.';
  return {changes,meaning,pressure:`At inspiration: airway ${after.pplat.toFixed(1)} − mean pleural ${after.meanPleuralEI.toFixed(1)} = mean transpulmonary ${after.transpulmonaryEI.toFixed(1)} cmH2O. Pleural pressure changes ${(after.meanPleuralEI-after.meanPleuralEE).toFixed(1)} cmH2O within the displayed breath.`,scope:'This explains a model response; it does not select a clinically optimal PEEP or establish treatment benefit.'};
}
