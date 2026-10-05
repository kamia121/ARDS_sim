function validate(tr){
  if(!tr||typeof tr!=='object')throw new TypeError('playback: trajectory is required');
  const f=tr.frames;
  if(!Array.isArray(f)||!f.length)throw new RangeError('playback: trajectory has no frames');
  if(!Number.isFinite(tr.cycle)||tr.cycle<0)throw new RangeError('playback: cycle must be a finite non-negative number');
  const {eiIndex:e,releaseIndex:r}=tr;
  if(!Number.isInteger(e)||!Number.isInteger(r)||e<0||r<=e||r>=f.length)throw new RangeError('playback: eiIndex/releaseIndex must be integers with 0 <= eiIndex < releaseIndex < frames.length');
  let prev=-Infinity;
  f.forEach((fr,i)=>{
    if(!fr||!Number.isFinite(fr.time))throw new TypeError(`playback: frame ${i} has no finite time`);
    if(fr.time<prev)throw new RangeError(`playback: frame ${i} time decreases`);
    prev=fr.time;
  });
}
function blend(a,b,w,phase){
  const out={};
  for(const k of Object.keys(a)){
    const x=a[k],y=b[k];
    if(typeof x==='number'&&typeof y==='number')out[k]=x+(y-x)*w;
    else if(ArrayBuffer.isView(x)&&ArrayBuffer.isView(y)){
      if(x.length!==y.length)throw new RangeError(`playback: ${k} length differs between adjacent frames`);
      const z=new Float64Array(x.length);
      for(let i=0;i<z.length;i++)z[i]=x[i]+(y[i]-x[i])*w;
      out[k]=z;
    }else if(k==='ceilingActive')out[k]=Boolean(x)||Boolean(y);
    else out[k]=x;
  }
  out.time=a.time+(b.time-a.time)*w;
  out.phase=phase;
  return out;
}
export function sampleTrajectory(trajectory,time){
  validate(trajectory);
  if(typeof time!=='number'||Number.isNaN(time))throw new TypeError('playback: time must be a number');
  const {frames:f,cycle,eiIndex:e,releaseIndex:r}=trajectory;
  const last=f.length-1;
  const t=Math.min(Math.max(time,0),cycle);
  if(t>=f[last].time)return {frame:f[last],index:last,interpolated:false};
  if(t<=f[0].time)return {frame:f[0],index:0,interpolated:false};
  if(t===f[e].time)return {frame:f[e],index:e,interpolated:false};
  const inspiring=t<f[e].time;
  const lo=inspiring?0:r,hi=inspiring?e:last;
  for(let i=lo;i<=hi;i++)if(f[i].time===t)return {frame:f[i],index:i,interpolated:false};
  for(let i=lo;i<hi;i++){
    const a=f[i],b=f[i+1];
    if(t>a.time&&t<b.time){
      const w=(t-a.time)/(b.time-a.time);
      return {frame:blend(a,b,w,inspiring?'inspiration':'expiration'),index:i,interpolated:true};
    }
  }
  return {frame:f[hi],index:hi,interpolated:false};
}
export function frameLabel(frame,index,trajectory){
  validate(trajectory);
  const f=trajectory.frames;
  const i=Number.isInteger(index)?index:f.indexOf(frame);
  if(frame!==f[i])return frame.phase==='inspiration'?'Inspiration':'Expiration';
  if(i===trajectory.eiIndex)return 'End inspiration';
  if(i===trajectory.releaseIndex)return trajectory.kind==='frozen-aeration-airflow'?'Start expiration':'Pressure release';
  if(i===f.length-1)return 'End expiration';
  if(i===0)return 'Before inspiration';
  return i<trajectory.eiIndex?'Inspiration':'Expiration';
}
