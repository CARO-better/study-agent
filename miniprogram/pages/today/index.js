const planning = require('../../lib/study-plan');
const appearance = require('../../lib/appearance');
const shell = require('../../lib/shell');
const inbox = require('../../lib/inbox');
const backupLib = require('../../lib/backup');
const aiLib = require('../../lib/ai');
const cloud = require('../../lib/cloud');
const migrate = require('../../lib/migrate');
const sync = require('../../lib/sync');
const surface = require('../../lib/surface-bus');
const KEY = 'study_trial_v1';
const INBOX_KEY = 'study_inbox_v1';
const BACKUP_META_KEY = 'study_backup_meta_v1';
const types = ['作业','实验','考试','其他'];
const priorities = ['低','中','高'];
const ASSISTANT_CLOSE_MS = 240;
function localDate(d) { d = d || new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function stamp(date, time) { return new Date(date+'T'+time+':00+08:00').toISOString(); }
function display(v) { return new Date(Date.parse(v)+8*3600000).toISOString().slice(0,16).replace('T',' '); }
function fresh(){ return {courses:[],tasks:[],availability:[],blocks:[],unscheduled:[],previous:null}; }
function recordStamp(record){return record?JSON.stringify(Object.keys(record).sort().map(key=>[key,record[key]])):'';}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
Page({
 data:{shell:{navBottom:44,orbTop:0},showAssistant:false,assistantClosing:false,assistantSettings:false,showCompleted:false,showSync:false,closingSheet:'',sheetOrigin:{x:180,y:600},surfaceVisible:false,surfaceClosing:false,surfaceKind:'',surfaceAnchor:'',surfaceAnchorRadius:16,surfaceSize:'default',surfaceRevision:0,theme:'light',appearanceMode:'system',appearanceOptions:[{mode:'system',label:'跟随系统'},{mode:'light',label:'浅色'},{mode:'dark',label:'深色'}],motionEnabled:true,tab:'今日',tabs:['今日','课程','计划','设置'],store:fresh(),types,priorities,courseNames:['未关联课程'],courseForm:{},taskForm:{},availabilityForm:{},editing:'',today:localDate(),typeIndex:0,priorityIndex:1,courseIndex:0,inboxMessages:[],unread:0,showInbox:false,backupAt:''},
 onLoad(){this._unloaded=false;this.onResize();this.unbindAppearance=appearance.bind(this);const saved=wx.getStorageSync(KEY);this.setData({store:saved&&Array.isArray(saved.tasks)?{...fresh(),...saved}:fresh(),backupAt:this.backupLabel()});this.unsubscribe=sync.subscribe(value=>this.setData({syncStatus:value,syncTime:value.updatedAt?display(value.updatedAt):''}));this.refresh();this.refreshInbox();this.syncOnLoad();},
 // 先用本地数据把界面渲染出来（不能等网络），再异步拉云端：云端更新就覆盖。
 // 清缓存后本地是空的，这一步会自动从云端恢复，不需要用户点任何按钮。
 async syncOnLoad(){const result=await sync.reconcile();if(result.store)this.setData({store:{...fresh(),...result.store}});this.refresh();this.refreshInbox();if(result.restored)wx.showToast({title:'已恢复完整云端数据',icon:'none'});await sync.flush();},
 onShow(){appearance.paint(this.data.theme||'light');const saved=wx.getStorageSync(KEY);if(saved&&Array.isArray(saved.tasks)){this.setData({store:{...fresh(),...saved}});this.refresh();this.refreshInbox();}if(this.unsubscribe)sync.flush();},
 chooseAppearance(e){appearance.set({mode:e.currentTarget.dataset.mode});},
 toggleMotion(e){appearance.set({motion:e.detail.value});},
 onResize(){this.setData({shell:shell.layout()});},
 sourcePoint(event){
   const detail=event&&event.detail;
   if(detail&&Number.isFinite(Number(detail.x))&&Number.isFinite(Number(detail.y)))this._sourcePoint={x:Number(detail.x),y:Number(detail.y)};
   if(this._sourcePoint)return this._sourcePoint;
   let width=0;try{width=Number(wx.getWindowInfo&&wx.getWindowInfo().windowWidth)||0;}catch(_){}
   return {x:Math.round(width?width/2:180),y:600};
 },
 anchorSelector(event,fallback){
   const id=event&&event.currentTarget&&event.currentTarget.id;
   if(id)return '#'+id;
   const dataset=event&&event.currentTarget&&event.currentTarget.dataset;
   return (dataset&&dataset.anchor)||fallback||'';
 },
 anchorRadius(event){
   const dataset=event&&event.currentTarget&&event.currentTarget.dataset;
   return Number(dataset&&dataset.radius)||16;
 },
 openSheet(name,event,extra,opts){
   if(this._sheetTimer){clearTimeout(this._sheetTimer);this._sheetTimer=null;}
   const panel=this.selectComponent&&this.selectComponent('#surface');
   if(panel&&panel.stop)panel.stop(false);
   this._closingSheetName='';
   const size=name==='editor'?'form':name==='sync'?'compact':'default';
   this.setData({
     sheetOrigin:this.sourcePoint(event),
     surfaceVisible:true,
     surfaceClosing:false,
     surfaceKind:name,
     surfaceAnchor:this.anchorSelector(event,opts&&opts.fallbackAnchor),
     surfaceAnchorRadius:this.anchorRadius(event),
     surfaceSize:size,
     surfaceRevision:(Number(this.data.surfaceRevision)||0)+1,
     closingSheet:'',
     showSync:name==='sync',
     showInbox:name==='inbox',
     showResources:name==='resources',
     ...(extra||{})
   });
 },
 beginSheetClose(name){
   if(!this.data.surfaceVisible||this.data.surfaceClosing)return;
   if(this.data.surfaceKind!==name)return;
   const panel=this.selectComponent&&this.selectComponent('#surface');
   this._closingSheetName=name;
   this.setData({surfaceClosing:true,closingSheet:name});
   if(!panel||!panel.beginClose){this.finishSheetClose(name);return;}
   panel.beginClose();
 },
 finishSheetClose(name){
   if(this._closingSheetName!==name)return;
   if(this._sheetTimer){clearTimeout(this._sheetTimer);this._sheetTimer=null;}
   this._closingSheetName='';
   if(this._unloaded)return;
   this.setData({
     surfaceVisible:false,surfaceClosing:false,surfaceKind:'',surfaceAnchor:'',surfaceAnchorRadius:16,surfaceSize:'default',
     closingSheet:'',editing:'',showSync:false,showInbox:false,showResources:false
   });
 },
 surfaceClosed(){const name=this.data.surfaceKind||this.data.closingSheet||'editor';this.finishSheetClose(name);},
 closeSurface(){this.beginSheetClose(this.data.surfaceKind||'editor');},
 openAI(){
   if(this.data.assistantClosing)return;
   if(this.data.showAssistant){this.closeAssistant();return;}
   const closingEditor=this.data.surfaceKind==='editor';
   if(this._sheetTimer){clearTimeout(this._sheetTimer);this._sheetTimer=null;}
   this._closingSheetName='';
   const panel=this.selectComponent&&this.selectComponent('#surface');
   if(panel&&panel.stop)panel.stop(false);
   this.setData({showAssistant:true,assistantClosing:false,assistantSettings:false,surfaceVisible:false,surfaceClosing:false,surfaceKind:'',surfaceAnchor:'',closingSheet:'',showInbox:false,showResources:false,showSync:false,...(closingEditor?{editing:false}:{})});
 },
 openModelSettings(event){
   if(this.data.assistantClosing)return;
   if(event)this.sourcePoint(event);
   if(this._sheetTimer){clearTimeout(this._sheetTimer);this._sheetTimer=null;}
   this._closingSheetName='';
   this.setData({showAssistant:true,assistantClosing:false,assistantSettings:true,surfaceVisible:false,surfaceClosing:false,surfaceKind:'',surfaceAnchor:'',closingSheet:''});
 },
 closeAssistant(){
   if(this.data.assistantClosing||!this.data.showAssistant)return;
   const panel=this.selectComponent&&this.selectComponent('#assistant');
   if(panel&&panel.beginClose)panel.beginClose();
   if(!this.data.motionEnabled){this.finishAssistantClose();return;}
   if(this._assistantTimer)clearTimeout(this._assistantTimer);
   this.setData({assistantClosing:true});
   this._assistantTimer=setTimeout(()=>this.finishAssistantClose(),ASSISTANT_CLOSE_MS);
 },
 finishAssistantClose(){
   if(this._assistantTimer){clearTimeout(this._assistantTimer);this._assistantTimer=null;}
   if(this._unloaded)return;
   this.setData({showAssistant:false,assistantSettings:false,assistantClosing:false});
   this.onShow();
 },
 toggleCompleted(){this.setData({showCompleted:!this.data.showCompleted});},
 openSync(event){this.openSheet('sync',event,{showSync:true});},closeSync(){this.beginSheetClose('sync');},
 async quickAdd(event){this.sourcePoint(event);if(this.data.tab==='课程')this.openCourse({currentTarget:{dataset:{},id:'quick-add'}});else if(this.data.tab==='计划')await this.planMenu(event);else if(this.data.tab==='今日')this.openTask({currentTarget:{dataset:{},id:'quick-add'}});},
 async planMenu(event){const choice=await surface.menu({title:'添加时间',items:['可用时间','固定时间'],anchorSelector:this.anchorSelector(event,'#quick-add')});if(choice.index===0)this.openAvailability();if(choice.index===1)this.openFixedTime();},
 async taskActions(e){this.sourcePoint(e);const id=e.currentTarget.dataset.id;const choice=await surface.menu({title:'任务操作',items:['编辑','复习资源','删除'],anchorSelector:this.anchorSelector(e)});const event={currentTarget:{id:e.currentTarget.id,dataset:{id,kind:'task'}}};if(choice.index===0)this.openTask(event);if(choice.index===1)this.recommend(event);if(choice.index===2)this.remove(event);},
 async courseActions(e){this.sourcePoint(e);const id=e.currentTarget.dataset.id;const choice=await surface.menu({title:'课程操作',items:['编辑','删除'],anchorSelector:this.anchorSelector(e)});const event={currentTarget:{id:e.currentTarget.id,dataset:{id,kind:'course'}}};if(choice.index===0)this.openCourse(event);if(choice.index===1)this.remove(event);},
 async chooseAppearanceMenu(event){const choice=await surface.menu({title:'外观',items:this.data.appearanceOptions.map(x=>x.label),anchorSelector:this.anchorSelector(event,'#appearance-anchor')});if(choice.index>=0)this.chooseAppearance({currentTarget:{dataset:{mode:this.data.appearanceOptions[choice.index].mode}}});},
 async settingsMore(event){const choice=await surface.menu({title:'更多设置',items:['检测连接','预览同步内容','添加示例数据'],anchorSelector:this.anchorSelector(event,'#settings-more-anchor')});if(choice.index===0)this.probeCloud();if(choice.index===1)this.previewMigrate();if(choice.index===2)this.sample();},
 async saveEditor(){
   const latest=wx.getStorageSync(KEY);
   if(latest&&Array.isArray(latest.tasks)&&Array.isArray(latest.courses)){this.setData({store:{...fresh(),...latest}});this.refresh();}
   const kind=this.data.editing,form=kind==='task'?this.data.taskForm:this.data.courseForm;
   if(kind==='task'||kind==='course'){
     const list=kind==='task'?this.data.store.tasks:this.data.store.courses;
     const changed=form.id&&this.editorSource!==undefined&&recordStamp(list.find(x=>x.id===form.id))!==this.editorSource;
     const coursesChanged=kind==='task'&&this.editorCourseIds!==undefined&&JSON.stringify(this.data.store.courses.map(c=>c.id))!==this.editorCourseIds;
     if(changed||coursesChanged){await surface.alert({title:'内容已变化',content:'记录或课程已更新。草稿已保留，请重新打开后编辑。',showCancel:false});return;}
   }
   if(kind==='task')this.saveTask();else if(kind==='course')this.saveCourse();else if(kind==='availability')this.saveAvailability();
 },
 backupLabel(){const stamp=wx.getStorageSync(BACKUP_META_KEY); if(!stamp) return '从未备份'; return String(stamp).slice(0,16).replace('T',' ');},
 exportBackup(){const data=backupLib.buildBackup({trial:this.data.store,ai:aiLib.readSettings(k=>wx.getStorageSync(k)),inbox:wx.getStorageSync(INBOX_KEY)||null});wx.setClipboardData({data:JSON.stringify(data),success:()=>{wx.setStorageSync(BACKUP_META_KEY,new Date().toISOString());this.setData({backupAt:this.backupLabel()});surface.alert({title:'已复制学习数据备份',content:'备份不包含 API Key；模型配置继续由云端保管。请保存到你自己的文件中。',showCancel:false});}});},
 importBackup(){wx.getClipboardData({success:async res=>{let parsed;try{parsed=backupLib.parseBackup(res.data);}catch(error){await surface.alert({title:'无法恢复',content:error.message,showCancel:false});return;}const choice=await this.ask({title:'恢复这份备份？',content:backupLib.describe(parsed)+'\n会覆盖学习数据并保留本机恢复副本；不会导入旧备份里的明文 Key。',confirmText:'恢复备份',destructive:true});if(!choice.confirm)return;sync.recover(this.data.store,'before-backup-import');this.setData({store:parsed.trial});this.save(false);if(parsed.inbox)wx.setStorageSync(INBOX_KEY,parsed.inbox);this.refreshInbox();}});},
 save(replan=true){let store=this.data.store;if(replan)store=planning.autoReplan(store,new Date().toISOString());sync.save(store);this.setData({store});this.refresh();this.refreshInbox();},
 // 切后台或关页面时，把还没发出去的改动立刻推上去。
 onHide(){sync.flush();},
 onUnload(){this._unloaded=true;if(this._sheetTimer){clearTimeout(this._sheetTimer);this._sheetTimer=null;}if(this._assistantTimer){clearTimeout(this._assistantTimer);this._assistantTimer=null;}if(this.unbindAppearance)this.unbindAppearance();if(this.unsubscribe)this.unsubscribe();sync.flush();},
 // 诊断用：只读一次 tasks.list，确认云函数部署、集合创建、身份归属三件事都通了。
 // 不改任何数据，失败时给出可执行的下一步。
 probeCloud(){ cloud.probe().then(r=>{ surface.alert({title:r.ok?'云端已连通':'云端未连通',content:r.message+(r.hint?'\n\n下一步：'+r.hint:''),showCancel:false}); }); },
 // 只读预览：把本地数据转成云端结构，报数量和问题，**不上传任何东西**。
 previewMigrate(){const s=this.data.store;surface.alert({title:'完整快照预览（未上传）',content:'课程 '+s.courses.length+' 门，任务 '+s.tasks.length+' 条，可用时段 '+s.availability.length+' 个，安排 '+s.blocks.length+' 块。包含撤销记录，不含模型 Key。',showCancel:false});},
 ask(opts){ return surface.confirm(opts); },
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
   if(sync.status().state==='conflict'){
     if(!(await this.ask({title:'保留本机并覆盖云端？',content:'另一设备可能有更新。云端原快照会先保留恢复副本，再用当前完整数据覆盖。',confirmText:'保留本机'})).confirm)return;
     await sync.overwriteRemote();
   }else{sync.save(this.data.store);await sync.flush();}
   await surface.alert({title:'同步结果',content:sync.status().label,showCancel:false});
 },
 async restoreFromCloud(){
   if(!(await this.ask({title:'恢复完整云端快照？',content:'会覆盖课程、任务、可用时间与完整排期。当前数据会先保留恢复副本。云端模型 Key 不受影响。',confirmText:'恢复云端',destructive:true})).confirm)return;
   try{const result=await sync.restoreRemote();this.setData({store:result.store});this.refresh();this.refreshInbox();wx.showToast({title:'完整学习数据已恢复',icon:'none'});}catch(error){await surface.alert({title:'恢复失败',content:error.message,showCancel:false});}
 },
 async restoreRecovery(){
   const copies=wx.getStorageSync(sync.RECOVERY_KEY)||[];
   if(!copies.length){wx.showToast({title:'暂无恢复副本',icon:'none'});return;}
   if(!(await this.ask({title:'恢复覆盖前的副本？',content:'将恢复最近一次覆盖前的数据；遇到云端冲突会等待你选择。'})).confirm)return;
   const old=this.data.store;this.setData({store:copies[0].store});sync.recover(old,'before-local-recovery');this.save(false);
 },
 refresh(){const s=this.data.store; const names=['未关联课程'].concat(s.courses.map(c=>c.semester+' · '+c.name)); const courseName=id=>{const c=s.courses.find(x=>x.id===id);return c?c.name:'未关联课程'}; const tasks=s.tasks.map(t=>Object.assign({},t,{courseName:courseName(t.courseId),meta:shell.taskMeta(t,courseName(t.courseId)),typeLabel:types[t.typeIndex==null?['homework','experiment','exam','other'].indexOf(t.type):t.typeIndex]||'作业',priorityLabel:priorities[t.priorityIndex==null?['low','medium','high'].indexOf(t.priority):t.priorityIndex]||'中'})); const blocks=s.blocks.map(b=>{const t=s.tasks.find(x=>x.id===b.taskId); return Object.assign({},b,{title:t?t.title:'已删除任务',timeLabel:display(b.start)+' - '+display(b.end).slice(11)});}); const reasons={overdue:'已过截止时间',no_availability:'没有可用时段',below_minimum:'剩余时间不足 30 分钟',insufficient_time:'可用时间不足'}; const unscheduled=(s.unscheduled||[]).map(u=>{const t=s.tasks.find(x=>x.id===u.taskId);return Object.assign({},u,{title:t?t.title:'任务',reasonLabel:reasons[u.reason]||u.reason});}); this.setData({courseNames:names,tasks,pendingTasks:tasks.filter(t=>t.status!=='completed'),completedTasks:tasks.filter(t=>t.status==='completed'),blocks,unscheduled,availability:s.availability,openCount:s.tasks.filter(t=>t.status!=='completed').length,completedCount:s.tasks.filter(t=>t.status==='completed').length,fixedBlocks:s.fixedBlocks||[],planMessage:s.planMessage||''});},
 switchTab(e){this.setData({tab:e.currentTarget.dataset.tab,editing:''});},
 refreshInbox(){const today=inbox.localDate(); const saved=wx.getStorageSync(INBOX_KEY); const base=saved && Array.isArray(saved.messages)?saved:inbox.emptyStore(); const next=inbox.upsertDigest(base,inbox.buildDigest(this.data.store.tasks,{date:today,now:new Date().toISOString()})); wx.setStorageSync(INBOX_KEY,next); this.setData({today,inboxMessages:next.messages.map(m=>({date:m.date,summary:inbox.summaryText(m),items:m.items})),unread:inbox.unreadBadge(next,today)});},
 openInbox(event){const today=inbox.localDate(); const saved=wx.getStorageSync(INBOX_KEY); const next=inbox.markRead(saved && Array.isArray(saved.messages)?saved:inbox.emptyStore(),today); wx.setStorageSync(INBOX_KEY,next); this.openSheet('inbox',event,{unread:0,showInbox:true});},
 closeInbox(){this.beginSheetClose('inbox');},
 toggleFromInbox(e){const id=e.currentTarget.dataset.id; let s=this.data.store,t=s.tasks.find(x=>x.id===id); if(!t)return; t.status=t.status==='completed'?'open':'completed';t.version=(t.version||0)+1; this.setData({store:s}); this.save();},
 openCourse(e){const id=e.currentTarget.dataset.id; const item=this.data.store.courses.find(c=>c.id===id);this.editorSource=recordStamp(item);this.openSheet('editor',e,{editing:'course',courseForm:item?Object.assign({},item,{importanceIndex:Math.max(0,['low','medium','high'].indexOf(item.importance||'medium')),masteryIndex:Math.max(0,['low','medium','high'].indexOf(item.mastery||'medium'))}):{name:'',semester:'',importance:'medium',mastery:'medium',importanceIndex:1,masteryIndex:1}});},
 openTask(e){const id=e.currentTarget.dataset.id; const item=this.data.store.tasks.find(t=>t.id===id);this.editorSource=recordStamp(item);this.editorCourseIds=JSON.stringify(this.data.store.courses.map(c=>c.id));const f=item?Object.assign({},item):{title:'',courseId:'',typeIndex:0,priorityIndex:1,dueAt:'',remainingMinutes:60,examScope:''}; let ci=this.data.store.courses.findIndex(c=>c.id===f.courseId)+1;this.openSheet('editor',e,{editing:'task',taskForm:f,typeIndex:f.typeIndex||0,priorityIndex:f.priorityIndex==null?1:f.priorityIndex,courseIndex:ci});},
 openAvailability(){this.openSheet('editor',null,{editing:'availability',availabilityForm:{date:localDate(),start:'19:00',end:'21:00'}},{fallbackAnchor:'#quick-add'});},
 close(){this.beginSheetClose('editor');},
 field(e){let obj=this.data.editing==='course'?'courseForm':this.data.editing==='task'?'taskForm':'availabilityForm'; this.setData({[obj+'.'+e.currentTarget.dataset.field]:e.detail.value});},
 chooseType(e){this.setData({typeIndex:Number(e.detail.value)});},choosePriority(e){this.setData({priorityIndex:Number(e.detail.value)});},chooseCourse(e){this.setData({courseIndex:Number(e.detail.value)});},
 saveCourse(){let f=this.data.courseForm;if(!f.name.trim()||!f.semester.trim()){wx.showToast({title:'请填写学期和课程',icon:'none'});return;}let s=this.data.store; f.id=f.id||uid();f.importance=['low','medium','high'][Number(f.importanceIndex)];f.mastery=['low','medium','high'][Number(f.masteryIndex)];let i=s.courses.findIndex(x=>x.id===f.id); if(i<0)s.courses.push(f);else s.courses[i]=f;this.setData({store:s});this.save();this.beginSheetClose('editor');},
 saveTask(){let f=this.data.taskForm;let minutes=Number(f.remainingMinutes);if(!f.title.trim()||!Number.isInteger(minutes)||minutes<0||minutes>10000){wx.showToast({title:'请填写标题、日期和有效分钟数',icon:'none'});return;}let s=this.data.store; f.id=f.id||uid();f.remainingMinutes=minutes;f.typeIndex=this.data.typeIndex;f.priorityIndex=this.data.priorityIndex;f.courseId=this.data.courseIndex?s.courses[this.data.courseIndex-1].id:'';f.type=['homework','experiment','exam','other'][f.typeIndex];f.priority=['low','medium','high'][f.priorityIndex];f.status=f.status||'open';f.version=(f.version||0)+1;let i=s.tasks.findIndex(x=>x.id===f.id);if(i<0)s.tasks.push(f);else s.tasks[i]=f;this.setData({store:s});this.save();this.beginSheetClose('editor');},
 saveAvailability(){
   const f=this.data.availabilityForm,weeks=Number(f.repeatWeeks||1);
   if(!f.date||!f.start||!f.end||f.start>=f.end||!Number.isInteger(weeks)||weeks<1||weeks>30){wx.showToast({title:'请填写有效时间和重复周数（1—30）',icon:'none'});return;}
   const store=JSON.parse(JSON.stringify(this.data.store));
   for(let week=0;week<weeks;week++){
     const day=new Date(Date.parse(f.date+'T00:00:00+08:00')+week*7*86400000+8*3600000).toISOString().slice(0,10);
     const interval={id:uid(),date:day,startTime:f.start,endTime:f.end,start:stamp(day,f.start),end:stamp(day,f.end),title:String(f.title||'固定课程/占用时间')};
     if(f.fixed){store.fixedBlocks=store.fixedBlocks||[];store.fixedBlocks.push(interval);}else store.availability.push(interval);
   }
   this.setData({store});this.save();this.beginSheetClose('editor');
 },
 openFixedTime(){this.openSheet('editor',null,{editing:'availability',availabilityForm:{date:localDate(),start:'08:00',end:'10:00',fixed:true,repeatWeeks:1,title:''}},{fallbackAnchor:'#quick-add'});},
 toggleTask(e){let s=this.data.store,t=s.tasks.find(x=>x.id===e.currentTarget.dataset.id);if(t){t.status=t.status==='completed'?'open':'completed';t.version=(t.version||0)+1;this.setData({store:s});this.save();}},
 async remove(e){const kind=e.currentTarget.dataset.kind,id=e.currentTarget.dataset.id;const choice=await this.ask({title:'确认删除？',content:kind==='course'?'关联任务会保留，但不再关联课程。':'删除后无法恢复。',confirmText:'删除',destructive:true});if(!choice.confirm)return;let s=this.data.store;if(kind==='task'){s.tasks=s.tasks.filter(x=>x.id!==id);s.blocks=s.blocks.filter(x=>x.taskId!==id);s.unscheduled=s.unscheduled.filter(x=>x.taskId!==id);}if(kind==='course'){s.courses=s.courses.filter(x=>x.id!==id);s.tasks.forEach(t=>{if(t.courseId===id)t.courseId='';});}if(kind==='availability')s.availability=s.availability.filter(x=>x.id!==id);if(kind==='fixed')s.fixedBlocks=(s.fixedBlocks||[]).filter(x=>x.id!==id);this.setData({store:s});this.save();},
 async generate(){if(this.data.planBusy)return;this.setData({planBusy:true});try{let store;if(cloud.available()){sync.save(this.data.store);store=await sync.generatePlan();}else store=planning.generate(this.data.store,new Date().toISOString());this.setData({store});if(!cloud.available())this.save(false);else{this.refresh();this.refreshInbox();}wx.showToast({title:store.planStatus==='needs_attention'?'请先处理固定安排冲突':'学习计划已生成',icon:'none'});}catch(error){await surface.alert({title:'暂时无法生成',content:error.message,showCancel:false});}finally{this.setData({planBusy:false});}},
 lock(e){const s=JSON.parse(JSON.stringify(this.data.store)),b=s.blocks[Number(e.currentTarget.dataset.index)];if(b)b.locked=!b.locked;s.planVersion=(s.planVersion||0)+1;this.setData({store:s});this.save(false);},
 undo(){const result=planning.undo(this.data.store,new Date().toISOString());if(!result.ok){surface.alert({title:'无法撤销',content:result.reason,showCancel:false});return;}this.setData({store:result.store});this.save(false);},

 clearDeadline(){this.setData({'taskForm.dueAt':''});},
 async recommend(e){
   if(this.data.resourceBusy)return;
   const id=e&&e.currentTarget&&e.currentTarget.dataset.id;
   this.openSheet('resources',e,{resourceBusy:true,resources:[],resourceNotice:'正在检索哔哩哔哩实际课程…',showResources:true});
   try{await sync.flush();if(sync.status().dirty)throw Error('请先完成同步，再获取对应任务的推荐');const result=await cloud.call('resources.recommendSnapshot',{taskIds:id?[id]:[],limitPerTask:4,maxTasks:3});this.setData({resources:result.results,resourceNotice:result.results.length?'来源：哔哩哔哩实时检索；点击复制原视频链接':result.note||'没有可推荐的未完成任务'});}catch(error){this.setData({resourceNotice:error.code==='BILI_UNAVAILABLE'?`${error.message||'哔哩哔哩暂时无法检索，请稍后重试'}；未生成替代链接`:error.message});}finally{this.setData({resourceBusy:false});}
 },
 copyResource(e){const url=e.currentTarget.dataset.url;if(/^https:\/\/www\.bilibili\.com\/video\/[A-Za-z0-9]+/.test(url))wx.setClipboardData({data:url});},
 closeResources(){this.beginSheetClose('resources');},
 async sample(){const choice=await this.ask({title:'添加示例数据？',content:'会在当前数据中添加标注为示例的课程、任务和明日可用时间。',confirmText:'添加示例',destructive:true});if(!choice.confirm)return;let s=this.data.store;let d=new Date();d.setDate(d.getDate()+1);let date=localDate(d),id=uid();s.courses.push({id,name:'示例课程',semester:'示例学期'});s.tasks.push({id:uid(),title:'示例实验报告',courseId:id,typeIndex:1,priorityIndex:1,type:'experiment',priority:'medium',dueAt:date,remainingMinutes:60,status:'open',version:1});s.availability.push({id:uid(),date,startTime:'19:00',endTime:'21:00',start:stamp(date,'19:00'),end:stamp(date,'21:00')});this.setData({store:s});this.save();}
});
