'use strict';
const morph=require('../../lib/morph');
Component({
  options:{styleIsolation:'apply-shared'},
  properties:{
    visible:{type:Boolean,value:false},
    revision:{type:Number,value:0},
    anchor:{type:String,value:''},
    anchorRect:{type:Object,value:null},
    anchorRadius:{type:Number,value:16},
    size:{type:String,value:'default'},
    maskClosable:{type:Boolean,value:true},
    motionEnabled:{type:Boolean,value:true}
  },
  data:{phase:'closed',cardStyle:'',keyboardHeight:0},
  observers:{
    'visible,revision'(visible){
      if(visible)this.open();
      else this.stop(false);
    }
  },
  lifetimes:{
    attached(){
      this._generation=0;
      this._keyboardHandler=({height})=>{if(!this.disposed)this.setData({keyboardHeight:Number(height)||0});};
      if(wx.onKeyboardHeightChange)wx.onKeyboardHeightChange(this._keyboardHandler);
    },
    detached(){
      this.disposed=true;
      if(wx.offKeyboardHeightChange&&this._keyboardHandler)wx.offKeyboardHeightChange(this._keyboardHandler);
      this.stop(false);
    }
  },
  methods:{
    async open(){
      if(this._closeTimer){clearTimeout(this._closeTimer);this._closeTimer=null;}
      const generation=++this._generation;
      this.disposed=false;
      this.setData({phase:'measuring',cardStyle:'',keyboardHeight:0});
      await this.nextFrame();
      if(this.disposed||generation!==this._generation)return;
      const source=await this.resolveSource();
      const target=await this.measureCard();
      const transform=morph.transform(source,target);
      this._transform=transform;
      if(!this.properties.motionEnabled){
        this.setData({phase:'open',cardStyle:''});
        this.triggerEvent('opened');
        return;
      }
      this.setData({phase:'entering',cardStyle:`--morph-transform:${morph.transformStyle(transform)};--morph-radius:${transform.radius}px`});
      await this.nextFrame();
      if(this.disposed||generation!==this._generation)return;
      this.setData({phase:'open'});
      this.triggerEvent('opened');
    },
    beginClose(){
      if(this.disposed||this.data.phase==='closing'||this.data.phase==='closed')return;
      const transform=this._transform||morph.transform(morph.fallbackRect(),morph.fallbackRect());
      this._generation++;
      if(!this.properties.motionEnabled){this.stop(true);return;}
      this.setData({phase:'closing',cardStyle:`--morph-transform:${morph.transformStyle(transform)};--morph-radius:${transform.radius}px`});
      this._closeTimer=setTimeout(()=>this.stop(true),280);
    },
    stop(notify){
      if(this._closeTimer){clearTimeout(this._closeTimer);this._closeTimer=null;}
      this._generation++;
      if(this.data.phase!=='closed')this.setData({phase:'closed',cardStyle:'',keyboardHeight:0});
      if(notify)this.triggerEvent('closed');
    },
    nextFrame(){return new Promise(resolve=>setTimeout(resolve,16));},
    queryRect(select,scope){
      return new Promise(resolve=>{
        const query=scope?scope.createSelectorQuery():wx.createSelectorQuery&&wx.createSelectorQuery();
        if(!query)return resolve(null);
        let settled=false;
        const timer=setTimeout(()=>{if(!settled){settled=true;resolve(null);}},120);
        query.select(select).boundingClientRect(rect=>{
          if(settled)return;
          settled=true;clearTimeout(timer);resolve(rect||null);
        }).exec();
      });
    },
    async resolveSource(){
      if(this.properties.anchorRect&&Number(this.properties.anchorRect.width)>0)return this.properties.anchorRect;
      if(this.properties.anchor){
        const rect=await this.queryRect(this.properties.anchor,null);
        if(rect&&Number(rect.width)>0)return {...rect,radius:this.properties.anchorRadius};
      }
      return morph.fallbackRect();
    },
    async measureCard(){
      const rect=await this.queryRect('.surface-card',this);
      return rect&&Number(rect.width)>0?rect:{left:0,top:0,width:0,height:0};
    },
    stopTouch(){return false;},
    onDismiss(){if(this.properties.maskClosable&&(this.data.phase==='open'||this.data.phase==='entering'))this.triggerEvent('dismiss');}
  }
});
