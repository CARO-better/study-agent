'use strict';
// Called by a trusted scheduler with an owner from server-owned data, never a client-supplied owner.
// Retries failed deletions: tickets are retained until CloudBase confirms deletion.
async function cleanupOwnerUploads(owner,deps) {
  // Without storage access there is nothing to delete; callers stay usable in
  // local/test runs and the scheduler retries later.
  if(!deps.cloud || typeof deps.cloud.deleteFile!=='function') return {deleted:0,failed:0};
  const tickets=await deps.repository.list(owner,'uploadTickets'); const drafts=await deps.repository.list(owner,'importDrafts'); let deleted=0,failed=0;
  for(const ticket of tickets) {
    if(ticket.status!=='active') continue;
    const eligible=Date.parse(deps.now())>=Date.parse(ticket.cleanupAfter) || drafts.some(d=>d.fileId===ticket.fileId && ['confirmed','abandoned','expired'].includes(d.status));
    if(!eligible) continue;
    try { const result=await deps.cloud.deleteFile({fileList:[ticket.fileId]}); const item=result.fileList?.[0]; if(!item || item.status!==0) throw Error('delete failed'); await deps.repository.transaction(owner,async tx=>{const current=await tx.get(owner,'uploadTickets',ticket.id); if(current && current.status==='active') await tx.save(owner,'uploadTickets',{...current,status:'deleted',deletedAt:deps.now()},current.version);}); deleted++; } catch { failed++; }
  }
  return {deleted,failed};
}
module.exports={cleanupOwnerUploads};
