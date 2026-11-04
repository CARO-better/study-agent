'use strict';
const { buildPlan } = require('./planner');
function replan(state,change={}) {
  const now=Date.parse(state.now), previous=structuredClone(state.blocks||[]);
  const affected=new Set(change.taskIds||[]); const selective=affected.size>0 && change.reason!=='generate';
  const preserved=previous.filter(b=>b.locked || Date.parse(b.start)<now || (selective && !affected.has(b.taskId)));
  const active=state.tasks.filter(t=>(!selective || affected.has(t.id)) && !['completed','cancelled'].includes(t.status)).map(t=>({...t,remainingMinutes:Math.max(0,t.remainingMinutes-preserved.filter(b=>b.taskId===t.id && Date.parse(b.start)>=now).reduce((n,b)=>n+(Date.parse(b.end)-Date.parse(b.start))/60000,0))}));
  const result=buildPlan({tasks:active,availability:state.availability||[],fixedBlocks:[...(state.fixedBlocks||[]),...preserved],now:state.now,...state.settings});
  const plan={...state,...result,unscheduled:[...(selective?(state.unscheduled||[]).filter(x=>!affected.has(x.taskId)):[]),...result.unscheduled],reasons:[...(selective?(state.reasons||[]).filter(x=>!affected.has(x.taskId)):[]),...result.reasons],blocks:[...preserved,...result.blocks]};
  const revision={id:change.id,fromVersion:state.version,toVersion:state.version+1,beforeNeedsAttention:state.status==='needs_attention',beforeBlocks:previous,beforeUnscheduled:structuredClone(state.unscheduled||[]),beforeReasons:structuredClone(state.reasons||[]),afterBlocks:structuredClone(plan.blocks),taskVersions:Object.fromEntries(state.tasks.map(t=>[t.id,t.version])),taskIds:change.taskIds||[],reason:change.reason||'progress',removedBlocks:previous.filter(b=>!preserved.includes(b)),addedBlocks:structuredClone(result.blocks)};
  return {plan,revision};
}
function undoRevision(state,revision,expectedVersion) {
  const conflicts=[];
  if (!revision || state.version!==expectedVersion || revision.toVersion!==expectedVersion) conflicts.push({reason:'plan_changed'});
  if(revision?.beforeNeedsAttention) conflicts.push({reason:'prior_plan_needs_attention'});
  if(revision) for(const block of revision.beforeBlocks) { const task=(state.tasks||[]).find(t=>t.id===block.taskId); if(!task || ['completed','cancelled'].includes(task.status) || task.version!==revision.taskVersions[block.taskId]) conflicts.push({taskId:block.taskId,reason:'task_changed'}); }
  if(revision) for(const task of state.tasks||[]) { const total=revision.beforeBlocks.filter(b=>b.taskId===task.id && Date.parse(b.end)>Date.parse(state.now)).reduce((n,b)=>n+(Date.parse(b.end)-Math.max(Date.parse(b.start),Date.parse(state.now)))/60000,0); if(total>task.remainingMinutes) conflicts.push({taskId:task.id,reason:'remaining_work_exceeded'}); }
  return {plan: conflicts.length ? state : {...state,blocks:structuredClone(revision.beforeBlocks),unscheduled:structuredClone(revision.beforeUnscheduled||[]),reasons:structuredClone(revision.beforeReasons||[])},conflicts};
}
module.exports={replan,undoRevision};

