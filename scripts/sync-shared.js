'use strict';
// 单一来源：云端业务纯函数生成小程序副本，测试同时检查是否有漂移。
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const file of ['planner.js','revisions.js','study-plan.js']){
  const source=fs.readFileSync(path.join(root,'cloudfunctions/api/core',file),'utf8');
  fs.writeFileSync(path.join(root,'miniprogram/lib',file),source);
}
