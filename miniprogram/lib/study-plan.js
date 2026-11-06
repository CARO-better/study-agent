'use strict';
// 当前小程序的快照模型适配层。核心排程仍使用同一份 planner/revisions。
const { replan, undoRevision } = require('./revisions');
const clone = value => JSON.parse(JSON.stringify(value));
function environment(store) {
  return JSON.stringify({availability:store.availability,fixedBlocks:store.fixedBlocks||[],settings:store.plannerSettings||{}});
}
function generate(input, now, reason) {
  const store=clone(input),tasks=(store.tasks||[]).map(task=>{const course=(store.courses||[]).find(c=>c.id===task.courseId)||{};return {...task,courseImportance:course.importance,mastery:task.mastery||course.mastery};}),blocks=store.blocks||[];
  const conflicts=[];
  for(const block of blocks.filter(b=>b.locked&&Date.parse(b.end)>Date.parse(now))){
    const task=tasks.find(t=>t.id===block.taskId);
    const total=blocks.filter(b=>b.locked&&b.taskId===block.taskId&&Date.parse(b.end)>Date.parse(now)).reduce((n,b)=>n+(Date.parse(b.end)-Math.max(Date.parse(b.start),Date.parse(now)))/60000,0);
    if(!task||['completed','cancelled'].includes(task.status)||total>task.remainingMinutes)conflicts.push('固定安排与任务剩余用时或完成状态冲突');
    if((store.fixedBlocks||[]).some(b=>Date.parse(b.start)<Date.parse(block.end)&&Date.parse(b.end)>Date.parse(block.start)))conflicts.push('固定安排与课程时间冲突');
  }
  if(conflicts.length)return {...store,planStatus:'needs_attention',planMessage:Array.from(new Set(conflicts)).join('；')+'，请先解除相应锁定'};
  const result=replan({tasks,blocks,unscheduled:store.unscheduled||[],reasons:store.reasons||[],availability:store.availability||[],fixedBlocks:store.fixedBlocks||[],now,version:store.planVersion||0,settings:{horizonDays:90,...store.plannerSettings}}, {id:'revision-'+((store.planVersion||0)+1),reason:'generate'});
  // beforeBlocks belong to the environment that produced the previous plan.
  result.revision.environment=store.planEnvironment||environment(store);
  const active=new Set(tasks.filter(t=>!['completed','cancelled'].includes(t.status)).map(t=>t.id));
  const nextBlocks=result.plan.blocks.filter(b=>active.has(b.taskId));
  return {...store,blocks:nextBlocks,unscheduled:result.plan.unscheduled,reasons:result.plan.reasons,previous:result.revision,planVersion:(store.planVersion||0)+1,planEnvironment:environment(store),lastGeneratedAt:now,planStatus:'ready',planMessage:reason==='progress'?'已根据任务进度自动重排，保留固定安排':'已生成学习计划，保留固定安排'};
}
function autoReplan(store,now) {
  if(!store.lastGeneratedAt&&!(store.blocks||[]).length&&!(store.unscheduled||[]).length)return store;
  return generate(store,now,'progress');
}
function undo(store,now) {
  const previous=store.previous;
  if(!previous||!Array.isArray(previous.beforeBlocks)||previous.environment!==environment(store))return {ok:false,store,reason:'可用时间或计划已变化，无法安全撤销，请重新生成'};
  if(store.planStatus==='needs_attention')return {ok:false,store,reason:'请先处理固定安排冲突，再重新生成计划'};
  for(const block of previous.beforeBlocks){
    const start=Math.max(Date.parse(block.start),Date.parse(now)),end=Date.parse(block.end);
    if(end<=Date.parse(now))continue;
    if((store.fixedBlocks||[]).some(b=>Date.parse(b.start)<end&&Date.parse(b.end)>start))return {ok:false,store,reason:'旧安排与当前固定课程冲突，不能撤销'};
    let covered=start;
    for(const interval of (store.availability||[]).slice().sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))){if(Date.parse(interval.start)>covered)break;covered=Math.max(covered,Date.parse(interval.end));if(covered>=end)break;}
    if(covered<end)return {ok:false,store,reason:'旧安排已不在当前可用时间内，不能撤销'};
  }
  const result=undoRevision({tasks:store.tasks,blocks:store.blocks,version:store.planVersion,now},previous,store.planVersion);
  if(result.conflicts.length)return {ok:false,store,reason:'任务完成状态或剩余用时已变化，不能恢复旧安排'};
  return {ok:true,store:{...store,blocks:result.plan.blocks,unscheduled:result.plan.unscheduled,reasons:result.plan.reasons,previous:null,planVersion:store.planVersion+1,planMessage:'已撤销上次排程，任务实际进度保持不变'}};
}
module.exports={generate,autoReplan,undo};
