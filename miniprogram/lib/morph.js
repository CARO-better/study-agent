'use strict';
function transform(source,target){
  const from=source||fallbackRect();
  const to=target||fallbackRect();
  const targetWidth=Number(to.width);
  const targetHeight=Number(to.height);
  if(!(targetWidth>0&&targetHeight>0)){
    return {translateX:0,translateY:0,scaleX:0.86,scaleY:0.92,radius:Number(from.radius)||16};
  }
  const hasSource=Number(from.width)>0&&Number(from.height)>0;
  return {
    translateX:Number(from.left||0)-Number(to.left||0),
    translateY:Number(from.top||0)-Number(to.top||0),
    scaleX:hasSource?Number(from.width)/targetWidth:0.86,
    scaleY:hasSource?Number(from.height)/targetHeight:0.92,
    radius:Number(from.radius)||16
  };
}
function transformStyle(value){
  return `translate(${Math.round(Number(value.translateX)||0)}px, ${Math.round(Number(value.translateY)||0)}px) scale(${Number(value.scaleX)||1}, ${Number(value.scaleY)||1})`;
}
function touchRect(event,options){
  const detail=event&&event.detail;
  const x=Number(detail&&detail.x);
  const y=Number(detail&&detail.y);
  if(!Number.isFinite(x)||!Number.isFinite(y))return fallbackRect();
  const width=Number(options&&options.width)||44;
  const height=Number(options&&options.height)||44;
  const radius=Number(options&&options.radius)||14;
  return {left:x-width/2,top:y-height/2,width,height,radius};
}
function fallbackRect(){return {left:0,top:0,width:0,height:0,radius:16};}
module.exports={transform,transformStyle,touchRect,fallbackRect};
