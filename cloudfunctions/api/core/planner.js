'use strict';
const minute = 60000;
const time = value => Date.parse(value);
const iso = value => new Date(value).toISOString();
function deadline(value) { return value ? time(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999+08:00` : value) : Infinity; }
function buildPlan({tasks=[], availability=[], fixedBlocks=[], now, horizonDays=14, minMinutes=30, maxMinutes=90, breakMinutes=10}) {
  const start=time(now), end=start+horizonDays*86400000;
  if (!Number.isFinite(start) || !Number.isInteger(horizonDays) || horizonDays<1 || horizonDays>90 || !Number.isInteger(minMinutes) || minMinutes<30 || !Number.isInteger(maxMinutes) || maxMinutes<minMinutes || !Number.isInteger(breakMinutes) || breakMinutes<0) throw new TypeError('Invalid planner settings');
  let free=availability.map(b=>[Math.max(start,time(b.start)),Math.min(end,time(b.end))]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&a<b).sort((a,b)=>a[0]-b[0]);
  const merged=[]; for(const [a,b] of free) { const last=merged.at(-1); if(last && a<=last[1]) last[1]=Math.max(last[1],b); else merged.push([a,b]); } free=merged;
  function subtract(a,b) { free=free.flatMap(([s,e])=> b<=s||a>=e ? [[s,e]] : [[s,Math.min(a,e)],[Math.max(b,s),e]].filter(([x,y])=>x<y)); }
  for(const block of fixedBlocks) { const a=time(block.start), b=time(block.end); if(Number.isFinite(a)&&Number.isFinite(b)&&a<b) subtract(a-(block.taskId?breakMinutes*minute:0),b+(block.taskId?breakMinutes*minute:0)); }
  const blocks=[],unscheduled=[],reasons=[];
  const ordered=tasks.filter(t=>!['completed','cancelled'].includes(t.status)&&t.remainingMinutes>0).slice().sort((a,b)=>deadline(a.dueAt)-deadline(b.dueAt) || (b.type==='exam')-(a.type==='exam') || ({high:3,medium:2,low:1}[b.priority]||2)-({high:3,medium:2,low:1}[a.priority]||2) || String(a.id).localeCompare(String(b.id)));
  for(const task of ordered) {
    let left=task.remainingMinutes; const due=deadline(task.dueAt); let index=0;
    while(left>=minMinutes && index<free.length) {
      const [s,e]=free[index], available=Math.floor((Math.min(e,due)-s)/minute);
      let length=Math.min(maxMinutes,left,available);
      if(length<minMinutes) { index++; continue; }
      const finish=s+length*minute;
      blocks.push({taskId:task.id,taskVersion:task.version,start:iso(s),end:iso(finish),locked:false});
      subtract(s,finish+breakMinutes*minute); left-=length;
    }
    if(left>0) { const reason=due<=start?'overdue':(!availability.length?'no_availability':left<minMinutes?'below_minimum':'insufficient_time'); unscheduled.push({taskId:task.id,taskVersion:task.version,remainingMinutes:left,reason}); reasons.push({taskId:task.id,reason}); }
    if(due>end && Number.isFinite(due)) reasons.push({taskId:task.id,reason:'beyond_horizon',dueAt:task.dueAt});
  }
  return {blocks,unscheduled,reasons};
}
module.exports={buildPlan,deadline};
