'use strict';
const { fail } = require('./errors');
const { getRecord, writeRecord, isObject } = require('./records');
const { buildPlan } = require('./planner');
const { replan, undoRevision } = require('./revisions');
const stamp = s => typeof s==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s));
function intervals(a) { return Array.isArray(a) && a.length<=500 && a.every(x=>isObject(x)&&stamp(x.start)&&stamp(x.end)&&Date.parse(x.start)<Date.parse(x.end)); }
function periodMap(m) { return isObject(m) && Object.keys(m).length<=24 && Object.entries(m).every(([k,v])=>/^(?:[1-9]|1\d|2[0-4])$/.test(k) && isObject(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.end) && v.start<v.end); }
function validSettings(v) { return isObject(v) && Object.keys(v).every(k=>['minMinutes','maxMinutes','breakMinutes'].includes(k)) && Number.isInteger(v.minMinutes) && v.minMinutes>=30 && v.minMinutes<=240 && Number.isInteger(v.maxMinutes) && v.maxMinutes>=v.minMinutes && v.maxMinutes<=240 && Number.isInteger(v.breakMinutes) && v.breakMinutes>=0 && v.breakMinutes<=120; }
async function environmentVersion(tx,owner) { const result=[]; for(const c of ['profiles','courses','semesters']) { const rows=await tx.list(owner,c); result.push([c,rows.map(r=>[r.id,r.version]).sort((a,b)=>a[0].localeCompare(b[0]))]); } return JSON.stringify(result); }
async function config(tx,owner,now) {
  const profiles=await tx.list(owner,'profiles'), profile=profiles[0];
  const courses=await tx.list(owner,'courses'), semesters=await tx.list(owner,'semesters');
  const map=profile?.termPeriodTimes||{}, fixed=[];
  for(const course of courses) for(const entry of course.schedule) {
    if(entry.periods.some(n=>!map[n])) return {configurationNeeded:['termPeriodTimes']};
    const sem=semesters.find(s=>s.id===course.semesterId); if(!sem) return {configurationNeeded:['semester']};
    const initial=Date.parse(`${sem.startDate}T00:00:00+08:00`), localDay=new Date(initial+8*3600000).getUTCDay()||7;
    const monday=initial-(localDay-1)*86400000;
    for(const week of entry.weeks) for(const p of entry.periods) {
      const day=monday+((week-1)*7+entry.weekday-1)*86400000;
      const date=new Date(day+8*3600000).toISOString().slice(0,10);
      if(date<sem.startDate||date>sem.endDate) continue;
      fixed.push({start:new Date(Date.parse(`${date}T${map[p].start}:00+08:00`)).toISOString(),end:new Date(Date.parse(`${date}T${map[p].end}:00+08:00`)).toISOString()});
    }
  }
  return {availability:profile?.availability||[],fixedBlocks:fixed,settings:profile?.plannerSettings||{},now};
}
async function handlePlanner({owner,action,payload},deps) {
  const repo=deps.repository;
  if(action==='plan.get') return repo.get(owner,'plans','current');
  if(action==='profiles.setAvailability') {
    if(!intervals(payload.availability) || (payload.termPeriodTimes!==undefined && !periodMap(payload.termPeriodTimes)) || (payload.plannerSettings!==undefined && !validSettings(payload.plannerSettings))) fail('VALIDATION');
    return repo.transaction(owner,async tx=>{const p=await getRecord(tx,owner,'profiles',payload.id); if(p.version!==payload.expectedVersion) fail('CONFLICT'); return tx.save(owner,'profiles',{...p,availability:structuredClone(payload.availability),...(payload.termPeriodTimes!==undefined?{termPeriodTimes:structuredClone(payload.termPeriodTimes)}:{}),...(payload.plannerSettings!==undefined?{plannerSettings:structuredClone(payload.plannerSettings)}:{})},p.version);});
  }
  if(!['plan.generate','plan.progress','plan.undo','plan.manualBlock','plan.removeManualBlock'].includes(action)) fail('UNKNOWN_ACTION');
  return repo.transaction(owner,async tx=>{
    const current=await tx.get(owner,'plans','current'); const version=current?.version||0;
    if(!Number.isInteger(payload.expectedVersion)||payload.expectedVersion!==version) fail('CONFLICT');
    if(action==='plan.undo') {
      if(!current || typeof payload.revisionId!=='string') fail('VALIDATION');
      if(current.status==='needs_attention') return {plan:current,conflicts:[{reason:'plan_needs_attention'}]};
      const revision=await getRecord(tx,owner,'planRevisions',payload.revisionId);
      const tasks=await tx.list(owner,'tasks'); const undone=undoRevision({...current,tasks,now:deps.now()},revision,payload.expectedVersion);
      if(revision.environmentVersion!==await environmentVersion(tx,owner)) undone.conflicts.push({reason:'settings_changed'});
      if(undone.conflicts.length) return {plan:current,conflicts:undone.conflicts};
      const restored=await tx.save(owner,'plans',{...current,blocks:undone.plan.blocks,unscheduled:undone.plan.unscheduled,reasons:undone.plan.reasons,lastRevisionId:null},version);
      return {plan:restored,conflicts:[]};
    }
    if(action==='plan.removeManualBlock') {
      if(!current || typeof payload.blockId!=='string') fail('VALIDATION');
      const block=current.blocks.find(b=>b.id===payload.blockId); if(!block || !block.locked) fail('NOT_FOUND');
      return tx.save(owner,'plans',{...current,blocks:current.blocks.filter(b=>b.id!==payload.blockId)},version);
    }
    if(action==='plan.manualBlock') {
      if(!current || !isObject(payload.block) || !intervals([payload.block])) fail('VALIDATION');
      const task=await getRecord(tx,owner,'tasks',payload.block.taskId);
      const schedule=await config(tx,owner,deps.now()); if(schedule.configurationNeeded) return schedule;
      const b={id:deps.newId(),taskId:task.id,taskVersion:task.version,start:payload.block.start,end:payload.block.end,locked:true};
      if([...current.blocks,...schedule.fixedBlocks].some(x=>Date.parse(x.start)<Date.parse(b.end)&&Date.parse(x.end)>Date.parse(b.start))) fail('CONFLICT');
      return tx.save(owner,'plans',{...current,blocks:[...current.blocks,b]},version);
    }
    const settings=await config(tx,owner,deps.now()); if(settings.configurationNeeded) return settings;
    let tasks=await tx.list(owner,'tasks'); const changes=payload.changes||[];
    const affected=new Set(Array.isArray(changes)?changes.map(c=>c?.id):[]); const now=Date.parse(settings.now);
    const retained=(current?.blocks||[]).filter(b=>b.locked || Date.parse(b.start)<now || (action==='plan.progress' && current?.status!=='needs_attention' && !affected.has(b.taskId)));
    const conflicts=retained.filter(b=>Date.parse(b.end)>now && settings.fixedBlocks.some(c=>Date.parse(b.start)<Date.parse(c.end) && Date.parse(b.end)>Date.parse(c.start))).map(b=>({reason:'class_overlap',blockId:b.id,taskId:b.taskId}));
    if(action==='plan.progress') {
      if(!current || !Array.isArray(changes)||!changes.length||changes.length>50||!changes.every(isObject)||new Set(changes.map(c=>c.id)).size!==changes.length) fail('VALIDATION');
      for(const c of changes) { if(!isObject(c)||!Number.isInteger(c.expectedVersion)||(c.completed!==undefined && typeof c.completed!=='boolean')||!Number.isInteger(c.remainingMinutes)||c.remainingMinutes<0||c.remainingMinutes>100000) fail('VALIDATION'); const t=await getRecord(tx,owner,'tasks',c.id); if(t.version!==c.expectedVersion) fail('CONFLICT'); if(['completed','cancelled'].includes(t.status)) fail('CONFLICT'); const saved=await writeRecord(tx,owner,'tasks',{remainingMinutes:c.remainingMinutes,status:c.completed===true?'completed':'in_progress'},t,t.version,deps); tasks=tasks.map(item=>item.id===saved.id?saved:item); }
    }
    for(const task of tasks) {
      const locked=retained.filter(b=>b.locked && b.taskId===task.id && Date.parse(b.end)>now);
      const minutes=locked.reduce((n,b)=>n+(Date.parse(b.end)-Math.max(now,Date.parse(b.start)))/60000,0);
      if(locked.length && (['completed','cancelled'].includes(task.status)||minutes>task.remainingMinutes)) conflicts.push({reason:'locked_work_incompatible',taskId:task.id});
    }
    if(conflicts.length) {
      if(action==='plan.progress' || (current && current.status==='needs_attention')) {
        const plan=await tx.save(owner,'plans',{...current,status:'needs_attention',attentionConflicts:conflicts},version);
        return {plan,conflicts,status:'needs_attention'};
      }
      return {plan:current,conflicts};
    }
    const before=current?.blocks||[];
    const state={...settings,tasks,blocks:before,unscheduled:current?.unscheduled||[],reasons:current?.reasons||[],version};
    const result=replan(state,{id:deps.newId(),taskIds:changes.map(c=>c.id),reason:action==='plan.progress' && current?.status!=='needs_attention'?'progress':'generate'});
    result.plan.blocks=result.plan.blocks.map(b=>b.id?b:{...b,id:deps.newId()}); result.revision.afterBlocks=structuredClone(result.plan.blocks); result.revision.addedBlocks=result.plan.blocks.filter(b=>!before.some(old=>old.id===b.id));
    result.revision.environmentVersion=await environmentVersion(tx,owner);
    const revision=await tx.save(owner,'planRevisions',result.revision,0);
    const plan=await tx.save(owner,'plans',{id:'current',blocks:result.plan.blocks,unscheduled:result.plan.unscheduled,reasons:result.plan.reasons,lastRevisionId:revision.id},version);
    return {plan,revision};
  });
}
module.exports={handlePlanner};
