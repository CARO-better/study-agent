'use strict';
const crypto = require('node:crypto');
function key(masterKey) { const raw=String(masterKey||'').trim(); const k=Buffer.from(raw, 'base64'); if(k.length!==32 || k.toString('base64')!==raw) throw Error('Invalid master key'); return k; }
function encryptSecret(value,masterKey) { if(typeof value!=='string' || !value || value.length>4096) throw Error('Invalid secret'); const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key(masterKey),iv); const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}; }
function decryptSecret(e,masterKey) { if(!e || e.v!==1) throw Error('Invalid envelope'); const decipher=crypto.createDecipheriv('aes-256-gcm',key(masterKey),Buffer.from(e.iv,'base64')); decipher.setAuthTag(Buffer.from(e.tag,'base64')); return Buffer.concat([decipher.update(Buffer.from(e.data,'base64')),decipher.final()]).toString('utf8'); }
module.exports={encryptSecret,decryptSecret};
