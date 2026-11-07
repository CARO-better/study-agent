'use strict';
const morph=require('../../lib/morph');
const surface=require('../../lib/surface-bus');
Component({
  options:{styleIsolation:'apply-shared'},
  properties:{motionEnabled:{type:Boolean,value:true}},
  data:{visible:false,phase:'closed',request:null,draft:'',cardStyle:'',keyboardHeight:0},
  lifetimes:{
    attached(){
      this.disposed=false;
      this.unsubscribe=surface.subscribe(request=>this.open(request));
      this._keyboardHandler=({height})=>{if(!this.disposed)this.setData({keyboardHeight:Number(height)||0});};
      if(wx.onKeyboardHeightChange)wx.onKeyboardHeightChange(this._keyboardHandler);
    },
    detached(){
      this.disposed=true;
      if(this.unsubscribe)this.unsubscribe();
      if(wx.offKeyboardHeightChange&&this._keyboardHandler)wx.offKeyboardHeightChange(this._keyboardHandler);
      if(this._closeTimer)clearTimeout(this._closeTimer);
      if(this._request&&this._request.id)surface.settle(this._request.id,{confirm:false,content:this.data.draft});
    }
  },
  methods:{
    async open(request){
      if(!request)return;
      if(this._closeTimer){clearTimeout(this._closeTimer);this._closeTimer=null;}
      this._request=request;
      this._result={confirm:false,content:request.content||''};
      this._generation=(this._generation||0)+1;
      const generation=this._generation;
      this.setData({visible:true,phase:'measuring',request,draft:request.content||'',cardStyle:'',keyboardHeight:0});
      await new Promise(resolve=>setTimeout(resolve,16));
      if(this.disposed||generation!==this._generation)return;
      const source=await this.resolveSource(request);
      const target=await this.measureCard();
      const transform=morph.transform(source,target);
      this._transform=transform;
      if(!this.properties.motionEnabled){
        this.setData({phase:'open',cardStyle:''});
        return;
      }
      this.setData({phase:'entering',cardStyle:`--morph-transform:${morph.transformStyle(transform)};--morph-radius:${transform.radius}px`});
      await new Promise(resolve=>setTimeout(resolve,16));
      if(this.disposed||generation!==this._generation)return;
      this.setData({phase:'open'});
    },
    onInput(e){this.setData({draft:e.detail.value});},
    onMenuTap(e){
      const index=Number(e.currentTarget.dataset.index);
      const items=this.data.request&&this.data.request.items||[];
      const item=items[index];
      const action=item&&typeof item==='object'&&item.value!==undefined?item.value:item;
      this._result={confirm:true,index,action};
      this.beginClose();
    },
    onConfirm(){
      const request=this.data.request||{};
      if(request.type==='prompt'||request.editable)this._result={confirm:true,content:this.data.draft};
      else if(request.type==='alert')this._result={confirm:true};
      else this._result={confirm:true};
      this.beginClose();
    },
    onCancel(){
      this._result={confirm:false,content:this.data.draft};
      this.beginClose();
    },
    onDismiss(){
      const request=this.data.request||{};
      if(request.type==='alert'||request.maskClosable===false||request.showCancel===false)return;
      this.onCancel();
    },
    beginClose(){
      if(this.disposed||this.data.phase==='closing')return;
      if(!this.properties.motionEnabled){this.finish();return;}
      const transform=this._transform||morph.transform(morph.fallbackRect(),morph.fallbackRect());
      this._generation=(this._generation||0)+1;
      this.setData({phase:'closing',cardStyle:`--morph-transform:${morph.transformStyle(transform)};--morph-radius:${transform.radius}px`});
      this._closeTimer=setTimeout(()=>this.finish(),280);
    },
    finish(){
      if(this._closeTimer){clearTimeout(this._closeTimer);this._closeTimer=null;}
      const request=this._request;
      this._request=null;
      this.setData({visible:false,phase:'closed',request:null,cardStyle:'',keyboardHeight:0});
      if(request)surface.settle(request.id,this._result||{confirm:false});
    },
    queryRect(select,scope){
      return new Promise(resolve=>{
        const query=scope?scope.createSelectorQuery():wx.createSelectorQuery&&wx.createSelectorQuery();
        if(!query)return resolve(null);
        let settled=false;const timer=setTimeout(()=>{if(!settled){settled=true;resolve(null);}},120);
        query.select(select).boundingClientRect(rect=>{if(!settled){settled=true;clearTimeout(timer);resolve(rect||null);}}).exec();
      });
    },
    async resolveSource(request){
      if(request&&request.anchorRect&&Number(request.anchorRect.width)>0)return request.anchorRect;
      if(request&&request.anchorSelector){
        const rect=await this.queryRect(request.anchorSelector,null);
        if(rect&&Number(rect.width)>0)return {...rect,radius:Number(request.anchorRadius)||16};
      }
      return morph.fallbackRect();
    },
    async measureCard(){
      const rect=await this.queryRect('.dialog-card',this);
      return rect&&Number(rect.width)>0?rect:{left:0,top:0,width:0,height:0};
    },
    stopTouch(){return false;}
  }
});
