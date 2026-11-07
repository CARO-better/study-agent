'use strict';
// Conservative transport budgets for the mini-program bridge, not model image limits.
const MAX_IMAGE_CHARS=64000;
const MAX_REQUEST_BYTES=90000;
const MAX_LONG_EDGE=1440;
const ATTEMPTS=[{edge:1440,quality:78},{edge:1440,quality:55},{edge:1080,quality:65},{edge:800,quality:50},{edge:640,quality:42}];

function bytes(text){return encodeURIComponent(text).replace(/%[A-F\d]{2}/gi,'x').length;}
function failure(message,code,cause){const error=Error(message);error.code=code;if(cause)error.cause=cause;return error;}
function check(data){
  if(bytes(JSON.stringify(data))>MAX_REQUEST_BYTES){
    throw failure('文字和图片合计仍超过一次发送上限。已保留输入和附件，请缩短文字或只截取通知文字区域后重试。','PAYLOAD_TOO_LARGE');
  }
}
function invoke(platform,name,options,context){return new Promise((resolve,reject)=>{const payload={...options,success:resolve,fail:reject};if(context)platform[name](payload,context);else platform[name](payload);});}
function read(platform,path){return new Promise((resolve,reject)=>platform.getFileSystemManager().readFile({filePath:path,encoding:'base64',success:r=>resolve(String(r.data||'')),fail:reject}));}
function uri(data){
  if(data.startsWith('/9j/'))return 'data:image/jpeg;base64,'+data;
  if(data.startsWith('iVBOR'))return 'data:image/png;base64,'+data;
  throw failure('这张图片不是可发送的 JPEG 或 PNG，请重新选图或先截图。','IMAGE_UNSUPPORTED');
}
// Scale both axes by the longest edge. Bounding width alone leaves narrow, tall
// screenshots untouched even when they contain several times the allowed pixels.
function fit(width,height,maxEdge){
  const longest=Math.max(Number(width)||0,Number(height)||0);
  if(!longest)return null;
  const scale=Math.min(1,maxEdge/longest);
  return [Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale))];
}
async function canvasNode(platform,scope){
  for(let attempt=0;attempt<2;attempt++){
    const node=await new Promise(resolve=>{
      const query=scope&&typeof scope.createSelectorQuery==='function'?scope.createSelectorQuery():platform.createSelectorQuery&&platform.createSelectorQuery();
      if(!query)return resolve(null);
      query.select('#assistant-image-canvas').fields({node:true,size:true}).exec(result=>resolve(result&&result[0]&&result[0].node||null));
    });
    if(node)return node;
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw Error('图片处理画布尚未渲染');
}
function loadImage(canvas,path){
  return new Promise((resolve,reject)=>{
    const image=canvas.createImage();
    image.onload=()=>resolve(image);
    image.onerror=reject;
    image.src=path;
  });
}
// WeChat documents compressionImage quality as JPEG-only (and iOS as JPEG-only
// altogether). Re-encoding a PNG screenshot through a 2D canvas gives a stable
// JPEG fallback without lowering its dimensions until the text is unreadable.
async function transcode(platform,scope,path,info,width,height,quality){
  const canvas=await canvasNode(platform,scope);
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context)throw Error('图片处理画布不可用');
  const image=await loadImage(canvas,path);
  context.fillStyle='#FFFFFF';
  context.fillRect(0,0,width,height);
  context.drawImage(image,0,0,width,height);
  const output=await invoke(platform,'canvasToTempFilePath',{canvas,width,height,destWidth:width,destHeight:height,fileType:'jpg',quality:Math.max(.1,Math.min(.9,quality/100))});
  return output.tempFilePath;
}
async function prepare(file,platform=wx,scope=null){
  if(!file||!file.tempFilePath)throw failure('请重新选择图片','IMAGE_READ_FAILED');
  if(Number(file.size)>20*1024*1024)throw failure('图片超过 20MB，请先裁剪','IMAGE_TOO_LARGE');
  // Small files still need a real read: a 40KB PNG can exceed the Base64 budget.
  if(Number(file.size)&&Number(file.size)<=45000){
    try{
      const original=await read(platform,file.tempFilePath);
      if(original.length<=MAX_IMAGE_CHARS)return uri(original);
    }catch(_){/* fall through to metadata and compression */}
  }
  let info;
  try{info=await invoke(platform,'getImageInfo',{src:file.tempFilePath});}
  catch(error){throw failure('读不到这张图片，请重新选择或先截图','IMAGE_READ_FAILED',error);}

  const isJpeg=info&&info.type==='jpeg';
  const originalType=(info&&info.type)||'unknown';
  let bestChars=Infinity;
  let lastError=null;
  for(const attempt of ATTEMPTS){
    const size=fit(info.width,info.height,attempt.edge);
    if(!size)break;
    const [width,height]=size;
    let path='';
    // JPEG has a real quality parameter. PNG and unknown formats go through
    // canvas first because quality is documented as JPEG-only.
    if(isJpeg){
      try{
        const compressed=await invoke(platform,'compressImage',{src:file.tempFilePath,quality:attempt.quality,compressedWidth:width,compressedHeight:height});
        path=compressed.tempFilePath;
      }catch(error){lastError=error;}
    }
    if(!path){
      try{path=await transcode(platform,scope,file.tempFilePath,info,width,height,attempt.quality);}
      catch(error){
        lastError=error;
        try{
          const compressed=await invoke(platform,'compressImage',{src:file.tempFilePath,quality:attempt.quality,compressedWidth:width,compressedHeight:height});
          path=compressed.tempFilePath;
        }catch(fallbackError){lastError=fallbackError;}
      }
    }
    if(!path)continue;
    let data;
    try{data=await read(platform,path);}catch(error){lastError=error;continue;}
    bestChars=Math.min(bestChars,data.length);
    if(data.length<=MAX_IMAGE_CHARS)return uri(data);
  }
  const best=Number.isFinite(bestChars)?`压缩到 ${Math.ceil(bestChars/1024)}K 字符仍`:'压缩后仍然';
  const typeLabel=originalType==='jpeg'?'JPG':originalType==='png'?'PNG':'未知格式';
  throw failure(`这张图片${best}超过上限（原图 ${typeLabel}）。原图大小不是关键；长截图和 PNG 往往更难压缩，请裁剪到通知或作业文字区域后重试。`,'IMAGE_TOO_LARGE',lastError);
}
module.exports={prepare,check,bytes,fit,MAX_IMAGE_CHARS,MAX_REQUEST_BYTES,MAX_LONG_EDGE};
