'use strict';
// Conservative transport budgets for the mini-program bridge, not model image limits.
const MAX_IMAGE_CHARS=64000;
const MAX_REQUEST_BYTES=90000;
function bytes(text){return encodeURIComponent(text).replace(/%[A-F\d]{2}/gi,'x').length;}
function check(data){if(bytes(JSON.stringify(data))>MAX_REQUEST_BYTES)throw Object.assign(Error('消息和图片合计过大，请裁剪图片或重新打开 AI 后重试'),{code:'PAYLOAD_TOO_LARGE'});}
function invoke(platform,name,options){return new Promise((resolve,reject)=>platform[name]({...options,success:resolve,fail:reject}));}
function read(platform,path){return new Promise((resolve,reject)=>platform.getFileSystemManager().readFile({filePath:path,encoding:'base64',success:r=>resolve(r.data),fail:reject}));}
function uri(data){if(data.startsWith('/9j/'))return 'data:image/jpeg;base64,'+data;if(data.startsWith('iVBOR'))return 'data:image/png;base64,'+data;throw Error('请选择 JPEG 或 PNG 图片');}
async function prepare(file,platform=wx){
 if(file.size>20*1024*1024)throw Error('图片过大，请先裁剪');
 if(file.size<=45000){const data=await read(platform,file.tempFilePath);if(data.length<=MAX_IMAGE_CHARS)return uri(data);}
 const info=await invoke(platform,'getImageInfo',{src:file.tempFilePath});
 const widths=[1440,1080,800,640],qualities=[80,65,50,40];
 for(let i=0;i<widths.length;i++){
   const result=await invoke(platform,'compressImage',{src:file.tempFilePath,quality:qualities[i],compressedWidth:Math.min(info.width,widths[i])});
   const data=await read(platform,result.tempFilePath);
   if(data.length<=MAX_IMAGE_CHARS)return uri(data);
 }
 throw Error('图片压缩后仍过大，请裁剪到通知或作业文字区域后重试');
}
module.exports={prepare,check,bytes,MAX_IMAGE_CHARS,MAX_REQUEST_BYTES};
