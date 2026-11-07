'use strict';
let listeners=[];
let sequence=0;
let current=null;
let queue=[];
const pending=new Map();
function subscribe(listener){if(typeof listener!=='function')return()=>{};listeners=listeners.concat(listener);return()=>{listeners=listeners.filter(item=>item!==listener);if(!listeners.length)drainUnattached();};}
function drainUnattached(){
  const result={confirm:false,index:-1,content:''};
  pending.forEach(resolve=>resolve(result));
  pending.clear();
  queue=[];
  current=null;
}
function notify(request){const listener=listeners[listeners.length-1];if(!listener)return;try{listener(request);}catch(_){}}
function settle(id,result){
  const resolve=pending.get(id);
  if(resolve){pending.delete(id);resolve(result||{confirm:false});}
  if(current&&current.id===id)current=null;
  processNext();
}
function processNext(){
  if(current||!queue.length)return;
  current=queue.shift();
  notify(current);
}
function nativeFallback(request){
  return new Promise(resolve=>{
    if(request.type==='menu'){
      const items=request.items||[];
      wx.showActionSheet({
        itemList:items.map(item=>typeof item==='string'?item:item.label),
        success:r=>resolve({confirm:true,index:r.tapIndex,action:items[r.tapIndex]}),
        fail:()=>resolve({confirm:false,index:-1})
      });
      return;
    }
    wx.showModal({
      title:request.title||'',
      content:request.content||'',
      editable:!!request.editable,
      placeholderText:request.placeholderText||'',
      showCancel:request.type!=='alert'&&request.showCancel!==false,
      confirmText:request.confirmText||'确定',
      cancelText:request.cancelText||'取消',
      success:r=>resolve({confirm:!!r.confirm,content:r.content||request.content||''}),
      fail:()=>resolve({confirm:false,content:''})
    });
  });
}
function request(type,options){
  return new Promise(resolve=>{
    const id=++sequence;
    const payload=Object.assign({type,id},options||{});
    if(!listeners.length){nativeFallback(payload).then(resolve);return;}
    pending.set(id,resolve);
    if(current){queue.push(payload);return;}
    current=payload;notify(payload);
  });
}
function menu(options){return request('menu',options);}
function confirm(options){return request('confirm',options);}
function alert(options){return request('alert',options);}
function prompt(options){return request('prompt',Object.assign({editable:true},options));}
function reset(){listeners=[];sequence=0;drainUnattached();}
module.exports={subscribe,settle,menu,confirm,alert,prompt,reset};
