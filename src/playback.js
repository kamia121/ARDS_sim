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
export function transitionFrame(trajectory,w){
  validate(trajectory);
  if(trajectory.kind!=='quasi-static-steps')throw new TypeError('playback: transitionFrame requires a quasi-static-steps trajectory');
  if(typeof w!=='number'||!Number.isFinite(w)||w<0||w>1)throw new RangeError('playback: transition weight must be a finite number from 0 to 1');
  const ei=trajectory.frames[trajectory.eiIndex],release=trajectory.frames[trajectory.releaseIndex];
  if(w===0)return ei;
  if(w===1)return release;
  const out=blend(ei,release,w,'transition');
  out.time=ei.time;
  return out;
}
export function loopTransitionFrame(trajectory,w){
  validate(trajectory);
  if(typeof w!=='number'||!Number.isFinite(w)||w<0||w>1)throw new RangeError('playback: transition weight must be a finite number from 0 to 1');
  const f=trajectory.frames,last=f[f.length-1],first=f[0];
  if(w===0)return last;
  if(w===1)return first;
  const out=blend(last,first,w,'loop-transition');
  out.time=last.time;
  return out;
}
function timings(o){
  if(o===null||typeof o!=='object')throw new TypeError('playback: options must be an object');
  const v={hold:.45,eiTransition:.5,loopTransition:.35,loop:true,...o};
  for(const k of ['hold','eiTransition','loopTransition'])
    if(typeof v[k]!=='number'||!Number.isFinite(v[k])||v[k]<0)throw new RangeError(`playback: ${k} must be a finite non-negative number`);
  if(typeof v.loop!=='boolean')throw new TypeError('playback: loop must be a boolean');
  return v;
}
// Root requirement: when segment is 'expiration' and elapsed is the segment start, replayTime equals ti and
// sampleTrajectory would return the EI frame; the root must show frames[releaseIndex] explicitly instead.
export function displaySegment(trajectory,elapsed,options={}){
  validate(trajectory);
  if(typeof elapsed!=='number'||!Number.isFinite(elapsed)||elapsed<0)throw new RangeError('playback: elapsed must be a finite non-negative number');
  const o=timings(options);
  const {cycle,frames:f,eiIndex:e}=trajectory;
  const ti=f[e].time;
  const ei=trajectory.kind==='quasi-static-steps'?o.eiTransition:0;
  const loopT=o.loop?o.loopTransition:0;
  const period=cycle+o.hold+ei+loopT;
  const holdEnd=ti+o.hold,eiEnd=holdEnd+ei,expEnd=cycle+o.hold+ei;
  const r=(segment,replayTime,weight)=>({segment,replayTime,weight,period});
  if(elapsed>=period)return r('done',cycle,1);
  if(elapsed<ti)return r('inspiration',elapsed,0);
  if(elapsed<holdEnd)return r('hold',ti,0);
  if(elapsed<eiEnd)return r('ei-transition',ti,(elapsed-holdEnd)/ei);
  if(elapsed<expEnd)return r('expiration',Math.min(Math.max(elapsed-o.hold-ei,ti),cycle),0);
  return r('loop-transition',cycle,(elapsed-expEnd)/loopT);
}
export function displayElapsed(trajectory,time,index,options={}){
  validate(trajectory);
  if(typeof time!=='number'||!Number.isFinite(time))throw new RangeError('playback: time must be a finite number');
  const f=trajectory.frames;
  if(!Number.isInteger(index)||index<0||index>=f.length)throw new RangeError('playback: index must be a valid frame index');
  const o=timings(options);
  const ei=trajectory.kind==='quasi-static-steps'?o.eiTransition:0;
  const ti=f[trajectory.eiIndex].time;
  const t=Math.min(Math.max(time,0),trajectory.cycle);
  if(t<ti||(t===ti&&index<=trajectory.eiIndex))return t;
  return t+o.hold+ei;
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
