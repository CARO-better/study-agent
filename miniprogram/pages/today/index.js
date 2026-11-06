const planner = require('../../lib/planner');
const inbox = require('../../lib/inbox');
const backupLib = require('../../lib/backup');
const aiLib = require('../../lib/ai');
const cloud = require('../../lib/cloud');
const migrate = require('../../lib/migrate');
const sync = require('../../lib/sync');
const KEY = 'study_trial_v1';
const INBOX_KEY = 'study_inbox_v1';
const BACKUP_META_KEY = 'study_backup_meta_v1';
const types = ['作业','实验','考试','其他'];
const priorities = ['低','中','高'];
function localDate(d) { d = d || new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function stamp(date, time) { return new Date(date+'T'+time+':00').toISOString(); }
function display(v) { const d=new Date(v); return localDate(d)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function fresh(){ return {courses:[],tasks:[],availability:[],blocks:[],unscheduled:[],previous:null}; }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
Page({
 data:{tab:'今日',tabs:['今日','课程','计划','设置'],store:fresh(),types,priorities,courseNames:['未关联课程'],courseForm:{},taskForm:{},availabilityForm:{},editing:'',today:localDate(),typeIndex:0,priorityIndex:1,courseIndex:0,inboxMessages:[],unread:0,showInbox:false,backupAt:''},
 onLoad(){ let saved=wx.getStorageSync(KEY); const store=saved && saved.courses ? saved : fresh(); this.setData({store, backupAt:this.backupLabel()}); this.refresh(); this.refreshInbox(); this.syncOnLoad(store); },
 // 先用本地数据把界面渲染出来（不能等网络），再异步拉云端：云端更新就覆盖。
 // 清缓存后本地是空的，这一步会自动从云端恢复，不需要用户点任何按钮。
 syncOnLoad(local){ if(!cloud.available()) return; const isEmpty=!(local.courses&&local.courses.length)&&!(local.tasks&&local.tasks.length); sync.pull().then(remote=>{ if(sync.decide(remote.updatedAt,sync.localStamp(),isEmpty)!=='remote'||!remote.store) return; this.setData({store:remote.store}); wx.setStorageSync(KEY,remote.store); sync.markLocal(remote.updatedAt); this.refresh(); this.refreshInbox(); wx.showToast({title:isEmpty?'已从云端恢复数据':'已同步云端更新',icon:'none'}); }).catch(error=>console.warn('[sync] 拉取失败',error&&error.code,error&&error.message)); },
 onShow(){ const saved=wx.getStorageSync(KEY); if(saved && saved.courses){ this.setData({store:saved}); this.refresh(); this.refreshInbox(); } },
 openAI(){ wx.navigateTo({url:'/pages/ai/index'}); },
 backupLabel(){const stamp=wx.getStorageSync(BACKUP_META_KEY); if(!stamp) return '从未备份'; return String(stamp).slice(0,16).replace('T',' ');},
 exportBackup(){const data=backupLib.buildBackup({trial:this.data.store,ai:aiLib.readSettings(wx.getStorageSync),inbox:wx.getStorageSync(INBOX_KEY)||null},new Date().toISOString()); wx.setClipboardData({data:JSON.stringify(data),success:()=>{wx.setStorageSync(BACKUP_META_KEY,new Date().toISOString()); this.setData({backupAt:this.backupLabel()}); wx.showModal({title:'已复制到剪贴板',content:'把它粘贴到微信收藏或「文件传输助手」里保存。这段文本含你的 API Key，不要发给别人。',showCancel:false});}});},
 importBackup(){wx.getClipboardData({success:res=>{let parsed; try{parsed=backupLib.parseBackup(res.data);}catch(error){wx.showModal({title:'无法恢复',content:error.message,showCancel:false});return;} wx.showModal({title:'恢复这份备份？',content:backupLib.describe(parsed)+'\n\n会覆盖当前本机的任务和设置。',success:r=>{if(!r.confirm)return; this.setData({store:parsed.trial}); wx.setStorageSync(KEY,parsed.trial); if(parsed.ai) wx.setStorageSync('study_ai_v1',parsed.ai); if(parsed.inbox) wx.setStorageSync(INBOX_KEY,parsed.inbox); this.refresh(); this.refreshInbox(); wx.showToast({title:'已恢复',icon:'success'});}});}});},
 save(){wx.setStorageSync(KEY,this.data.store); this.refresh(); this.refreshInbox(); sync.schedule(this.data.store);},
 // 切后台或关页面时，把还没发出去的改动立刻推上去。
 onHide(){ sync.flush(); },
 // 诊断用：只读一次 tasks.list，确认云函数部署、集合创建、身份归属三件事都通了。
 // 不改任何数据，失败时给出可执行的下一步。
 probeCloud(){ cloud.probe().then(r=>{ wx.showModal({title:r.ok?'云端已连通':'云端未连通',content:r.message+(r.hint?'\n\n下一步：'+r.hint:''),showCancel:false}); }); },
 // 只读预览：把本地数据转成云端结构，报数量和问题，**不上传任何东西**。
 previewMigrate(){ const plan=migrate.buildPlan(this.data.store); if(plan.problems.length) console.warn('[migrate] 必须先解决的问题：',plan.problems); if(plan.notes.length) console.info('[migrate] 提示：',plan.notes); wx.showModal({title:'上云预览（未上传）',content:migrate.describePlan(plan),showCancel:false}); },
 ask(opts){ return new Promise(resolve=>wx.showModal({...opts,success:resolve,fail:()=>resolve({confirm:false})})); },
 // 逐个学期确认日期：默认用推断值，用户可以改成「开始,结束,周数」。
 async confirmTerms(plan){
   for(const term of plan.semesters){
     const r=await this.ask({title:'学期「'+term.name+'」',content:'推断 '+term.startDate+' ~ '+term.endDate+'，'+term.teachingWeeks+' 周。\n\n用这个日期，还是手动填？',confirmText:'用这个',cancelText:'手动填'});
     if(r.confirm) continue;
     const e=await this.ask({title:'填日期',content:term.startDate+','+term.endDate+','+term.teachingWeeks,editable:true,placeholderText:'开始,结束,周数  例 2026-09-01,2027-01-15,20',confirmText:'确定'});
     if(!e.confirm) return false;
     const parts=String(e.content||'').split(/[,，\s]+/).filter(Boolean);
     const [start,end,weeks]=parts;
     const okDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'');
     const w=Number(weeks);
     if(!okDate(start)||!okDate(end)||start>end||!Number.isInteger(w)||w<1||w>60){
       await this.ask({title:'格式不对',content:'要三个值：开始日期,结束日期,周数（1-60）。例：2026-09-01,2027-01-15,20',showCancel:false});
       return false;
     }
     term.startDate=start; term.endDate=end; term.teachingWeeks=w;
   }
   return true;
 },
 async uploadToCloud(){
   const plan=migrate.buildPlan(this.data.store);
   const s=plan.summary;
   if(!s.semesters&&!s.courses&&!s.tasks){ wx.showModal({title:'没有可上传的数据',content:'本地还没有课程或任务，先在「课程」和「今日」里添加。',showCancel:false}); return; }
   if(plan.problems.length){ wx.showModal({title:'先解决这些问题（'+plan.problems.length+'）',content:plan.problems.slice(0,4).join('\n\n'),showCancel:false}); return; }
   if(!(await this.confirmTerms(plan))) return;
   const go=await this.ask({title:'确认上传',content:'学期 '+s.semesters+' 个、课程 '+s.courses+' 门、任务 '+s.tasks+' 条。\n\n本地数据会原样保留，云端存的是副本。继续？',confirmText:'上传'});
   if(!go.confirm) return;
   wx.showLoading({title:'上传中…',mask:true});
   try{
     const report=await migrate.upload(plan,{call:cloud.call,onProgress:({done,total})=>wx.showLoading({title:'上传中 '+Math.round(done/Math.max(total,1)*100)+'%',mask:true})});
     wx.hideLoading();
     const lines=['成功：学期 '+report.semesters+'、课程 '+report.courses+'、任务 '+report.tasks];
     if(report.errors.length) lines.push('','有 '+report.errors.length+' 条失败：',...report.errors.slice(0,3));
     console.warn('[migrate] 完整报告：',report);
     wx.setStorageSync('study_cloud_migrated_at',report.uploadedAt);
     wx.showModal({title:report.errors.length?'部分完成':'上传完成',content:lines.join('\n'),showCancel:false});
   }catch(error){
     wx.hideLoading();
     wx.showModal({title:'上传中断',content:(error&&error.message)||String(error)+'\n\n已上传的部分会留在云端，可以重试；本地数据没动。',showCancel:false});
   }
 },
 // 清缓存或换手机后，把云端数据拉回本地。注意排期结果不在云端，恢复后要重新生成。
 async restoreFromCloud(){
   const ok=await this.ask({title:'从云端恢复',content:'云端数据会覆盖本机的课程和任务。\n\n排期结果不在云端，恢复后需要重新生成。继续？',confirmText:'覆盖本机'});
   if(!ok.confirm) return;
   wx.showLoading({title:'读取云端…',mask:true});
   try{
     const data=await migrate.restore({call:cloud.call});
     const store={courses:data.courses,tasks:data.tasks,availability:[],blocks:[],unscheduled:[],previous:null};
     this.setData({store});
     wx.setStorageSync(KEY,store);
     wx.hideLoading();
     this.refresh(); this.refreshInbox();
     wx.showModal({title:'已恢复',content:'课程 '+data.courses.length+' 门、任务 '+data.tasks.length+' 条。\n\n排期需要重新生成。AI 的 API Key 不在云端，要去设置里重填。',showCancel:false});
   }catch(error){
     wx.hideLoading();
     wx.showModal({title:'恢复失败',content:(error&&error.message)||String(error),showCancel:false});
   }
 },
 refresh(){const s=this.data.store; const names=['未关联课程'].concat(s.courses.map(c=>c.semester+' · '+c.name)); const courseName=id=>{const c=s.courses.find(x=>x.id===id);return c?c.name:'未关联课程'}; const tasks=s.tasks.map(t=>Object.assign({},t,{courseName:courseName(t.courseId),typeLabel:types[t.typeIndex]||'作业',priorityLabel:priorities[t.priorityIndex]||'中'})); const blocks=s.blocks.map(b=>{const t=s.tasks.find(x=>x.id===b.taskId); return Object.assign({},b,{title:t?t.title:'已删除任务',timeLabel:display(b.start)+' - '+display(b.end).slice(11)});}); const reasons={overdue:'已过截止时间',no_availability:'没有可用时段',below_minimum:'剩余时间不足 30 分钟',insufficient_time:'可用时间不足'}; const unscheduled=(s.unscheduled||[]).map(u=>{const t=s.tasks.find(x=>x.id===u.taskId);return Object.assign({},u,{title:t?t.title:'任务',reasonLabel:reasons[u.reason]||u.reason});}); this.setData({courseNames:names,tasks,blocks,unscheduled,availability:s.availability});},
 switchTab(e){this.setData({tab:e.currentTarget.dataset.tab,editing:''});},
 refreshInbox(){const today=inbox.localDate(); const saved=wx.getStorageSync(INBOX_KEY); const base=saved && Array.isArray(saved.messages)?saved:inbox.emptyStore(); const next=inbox.upsertDigest(base,inbox.buildDigest(this.data.store.tasks,{date:today,now:new Date().toISOString()})); wx.setStorageSync(INBOX_KEY,next); this.setData({today,inboxMessages:next.messages.map(m=>({date:m.date,summary:inbox.summaryText(m),items:m.items})),unread:inbox.unreadBadge(next,today)});},
 openInbox(){const today=inbox.localDate(); const saved=wx.getStorageSync(INBOX_KEY); const next=inbox.markRead(saved && Array.isArray(saved.messages)?saved:inbox.emptyStore(),today); wx.setStorageSync(INBOX_KEY,next); this.setData({showInbox:true,unread:0});},
 closeInbox(){this.setData({showInbox:false});},
 toggleFromInbox(e){const id=e.currentTarget.dataset.id; let s=this.data.store,t=s.tasks.find(x=>x.id===id); if(!t)return; t.status=t.status==='completed'?'open':'completed'; this.setData({store:s}); this.save();},
 openCourse(e){const id=e.currentTarget.dataset.id; const item=this.data.store.courses.find(c=>c.id===id);this.setData({editing:'course',courseForm:item?Object.assign({},item):{name:'',semester:''}});},
 openTask(e){const id=e.currentTarget.dataset.id; const item=this.data.store.tasks.find(t=>t.id===id);const f=item?Object.assign({},item):{title:'',courseId:'',typeIndex:0,priorityIndex:1,dueAt:localDate(),remainingMinutes:60}; let ci=this.data.store.courses.findIndex(c=>c.id===f.courseId)+1;this.setData({editing:'task',taskForm:f,typeIndex:f.typeIndex||0,priorityIndex:f.priorityIndex==null?1:f.priorityIndex,courseIndex:ci});},
 openAvailability(){this.setData({editing:'availability',availabilityForm:{date:localDate(),start:'19:00',end:'21:00'}});},
 close(){this.setData({editing:''});},
 field(e){let obj=this.data.editing==='course'?'courseForm':this.data.editing==='task'?'taskForm':'availabilityForm'; this.setData({[obj+'.'+e.currentTarget.dataset.field]:e.detail.value});},
 chooseType(e){this.setData({typeIndex:Number(e.detail.value)});},choosePriority(e){this.setData({priorityIndex:Number(e.detail.value)});},chooseCourse(e){this.setData({courseIndex:Number(e.detail.value)});},
 saveCourse(){let f=this.data.courseForm;if(!f.name.trim()||!f.semester.trim()){wx.showToast({title:'请填写学期和课程',icon:'none'});return;}let s=this.data.store; f.id=f.id||uid();let i=s.courses.findIndex(x=>x.id===f.id); if(i<0)s.courses.push(f);else s.courses[i]=f;this.setData({store:s,editing:''});this.save();},
 saveTask(){let f=this.data.taskForm;let minutes=Number(f.remainingMinutes);if(!f.title.trim()||!f.dueAt||!Number.isInteger(minutes)||minutes<1||minutes>10000){wx.showToast({title:'请填写标题、日期和有效分钟数',icon:'none'});return;}let s=this.data.store; f.id=f.id||uid();f.remainingMinutes=minutes;f.typeIndex=this.data.typeIndex;f.priorityIndex=this.data.priorityIndex;f.courseId=this.data.courseIndex?s.courses[this.data.courseIndex-1].id:'';f.type=['homework','experiment','exam','other'][f.typeIndex];f.priority=['low','medium','high'][f.priorityIndex];f.status=f.status||'open';f.version=(f.version||0)+1;let i=s.tasks.findIndex(x=>x.id===f.id);if(i<0)s.tasks.push(f);else s.tasks[i]=f;this.setData({store:s,editing:''});this.save();},
 saveAvailability(){const f=this.data.availabilityForm;if(!f.date||!f.start||!f.end||f.start>=f.end){wx.showToast({title:'结束时间须晚于开始时间',icon:'none'});return;}let s=this.data.store;s.availability.push({id:uid(),date:f.date,startTime:f.start,endTime:f.end,start:stamp(f.date,f.start),end:stamp(f.date,f.end)});this.setData({store:s,editing:''});this.save();},
 toggleTask(e){let s=this.data.store,t=s.tasks.find(x=>x.id===e.currentTarget.dataset.id);if(t){t.status=t.status==='completed'?'open':'completed';this.setData({store:s});this.save();}},
 remove(e){const kind=e.currentTarget.dataset.kind,id=e.currentTarget.dataset.id;wx.showModal({title:'确认删除？',content:kind==='course'?'关联任务会保留，但不再关联课程。':'删除后无法恢复。',success:r=>{if(!r.confirm)return;let s=this.data.store;if(kind==='task'){s.tasks=s.tasks.filter(x=>x.id!==id);s.blocks=s.blocks.filter(x=>x.taskId!==id);s.unscheduled=s.unscheduled.filter(x=>x.taskId!==id);}if(kind==='course'){s.courses=s.courses.filter(x=>x.id!==id);s.tasks.forEach(t=>{if(t.courseId===id)t.courseId='';});}if(kind==='availability')s.availability=s.availability.filter(x=>x.id!==id);this.setData({store:s});this.save();}});},
 generate(){let s=this.data.store;let locked=s.blocks.filter(b=>b.locked && s.tasks.some(t=>t.id===b.taskId && t.status!=='completed'));let tasks=s.tasks.map(t=>{let used=locked.filter(b=>b.taskId===t.id).reduce((n,b)=>n+(Date.parse(b.end)-Date.parse(b.start))/60000,0);return Object.assign({},t,{remainingMinutes:Math.max(0,t.remainingMinutes-used)});});s.previous={blocks:JSON.parse(JSON.stringify(s.blocks)),unscheduled:JSON.parse(JSON.stringify(s.unscheduled))};let plan=planner.buildPlan({tasks,availability:s.availability,fixedBlocks:locked,now:new Date().toISOString(),horizonDays:90});s.blocks=locked.concat(plan.blocks).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));s.unscheduled=plan.unscheduled;this.setData({store:s});this.save();wx.showToast({title:'计划已生成',icon:'success'});},
 lock(e){let s=this.data.store,b=s.blocks[Number(e.currentTarget.dataset.index)];if(b)b.locked=!b.locked;this.setData({store:s});this.save();},
 undo(){let s=this.data.store;if(!s.previous){wx.showToast({title:'没有可撤销的计划',icon:'none'});return;}s.blocks=s.previous.blocks;s.unscheduled=s.previous.unscheduled;s.previous=null;this.setData({store:s});this.save();},
 sample(){wx.showModal({title:'添加示例数据？',content:'会在当前数据中添加标注为示例的课程、任务和明日可用时间。',success:r=>{if(!r.confirm)return;let s=this.data.store;let d=new Date();d.setDate(d.getDate()+1);let date=localDate(d),id=uid();s.courses.push({id,name:'示例课程',semester:'示例学期'});s.tasks.push({id:uid(),title:'示例实验报告',courseId:id,typeIndex:1,priorityIndex:1,type:'experiment',priority:'medium',dueAt:date,remainingMinutes:60,status:'open',version:1});s.availability.push({id:uid(),date,startTime:'19:00',endTime:'21:00',start:stamp(date,'19:00'),end:stamp(date,'21:00')});this.setData({store:s});this.save();}});}
});
