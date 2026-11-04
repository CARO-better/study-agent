'use strict';
const { fail } = require('./errors');
const { getRecord, writeRecord, isObject, date } = require('./records');
const { cleanupOwnerUploads } = require('./upload-cleanup');
// Confirming or abandoning a draft is the point where the original screenshot
// stops being needed. Cleanup is best effort: a failure never blocks the user,
// and the 24h sweep retries it.
async function releaseScreenshots(owner, deps) { try { await cleanupOwnerUploads(owner, deps); } catch { /* retried by the sweep */ } }
const normalTitle = value => String(value || '').trim().normalize('NFKC').toLowerCase().replace(/\s+/g, '');
function parseCandidate(candidate, referenceDate) {
  if (!isObject(candidate)) fail('VALIDATION');
  const result = structuredClone(candidate); const needs = [];
  if (result.dueAt === undefined || result.dueAt === null || result.dueAt === '') {
    result.dueAt = null;
    if (result.dueText === '下周五' && referenceDate) {
      const base = new Date(`${referenceDate}T00:00:00Z`); const weekday = base.getUTCDay() || 7;
      base.setUTCDate(base.getUTCDate() - weekday + 12); result.dueAt = base.toISOString().slice(0, 10);
    } else {
      needs.push('dueAt');
      if (result.dueText === '下周五' && !referenceDate) needs.push('referenceDate');
      else if (result.dueText) needs.push('dueText');
    }
  }
  if (result.schedule && (!Array.isArray(result.schedule.weeks) || result.schedule.weeks.length === 0)) needs.push('schedule.weeks');
  result.needsConfirmation = needs; return result;
}
function duplicateIds(candidate, tasks) {
  return tasks.filter(task => normalTitle(task.title) === normalTitle(candidate.title) && (task.courseId || null) === (candidate.courseId || null) && (task.dueAt || null) === (candidate.dueAt || null)).map(task => task.id);
}
async function handleImports({ owner, action, payload }, deps) {
  if (action === 'imports.get') return getRecord(deps.repository, owner, 'importDrafts', payload.id);
  if (action === 'imports.list') return deps.repository.list(owner, 'importDrafts');
  if (action === 'imports.updateDraft' || action === 'imports.abandon') {
    const updated = await deps.repository.transaction(owner, async tx => {
      const draft = await getRecord(tx, owner, 'importDrafts', payload.id);
      if (draft.version !== payload.expectedVersion || draft.status !== 'draft') fail('CONFLICT');
      if (Date.parse(deps.now()) >= Date.parse(draft.cleanupAfter)) fail('DRAFT_EXPIRED');
      if (action === 'imports.abandon') return tx.save(owner, 'importDrafts', { ...draft, status:'abandoned', text:'', candidates:[], boxes:[] }, draft.version);
      if (typeof payload.text !== 'string' || payload.text.length > 50000 || !Array.isArray(payload.candidates) || payload.candidates.length > 30) fail('VALIDATION');
      const tasks = await tx.list(owner, 'tasks');
      const candidates = payload.candidates.map(c => { const parsed = parseCandidate(c, draft.referenceDate); return { ...parsed, duplicateIds: duplicateIds(parsed, tasks) }; });
      return tx.save(owner, 'importDrafts', { ...draft, text:payload.text, candidates }, draft.version);
    });
    if (action === 'imports.abandon') await releaseScreenshots(owner, deps);
    return updated;
  }
  if (action === 'imports.create') {
    if (!['text', 'screenshot'].includes(payload.source) || typeof payload.text !== 'string' || payload.text.length > 50000 || !Array.isArray(payload.candidates) || payload.candidates.length < 1 || payload.candidates.length > 30 || (payload.referenceDate !== undefined && !date(payload.referenceDate))) fail('VALIDATION');
    return deps.repository.transaction(owner, async tx => {
      const tasks = await tx.list(owner, 'tasks');
      const candidates = payload.candidates.map(candidate => { const parsed = parseCandidate(candidate, payload.referenceDate); return { ...parsed, duplicateIds: duplicateIds(parsed, tasks) }; });
      return tx.save(owner, 'importDrafts', { id: deps.newId(), source: payload.source, text: payload.text, referenceDate: payload.referenceDate || null, candidates, status: 'draft', cleanupAfter: new Date(Date.parse(deps.now()) + 86400000).toISOString() }, 0);
    });
  }
  if (action === 'imports.confirm') {
    const result = await deps.repository.transaction(owner, async tx => {
      const draft = await getRecord(tx, owner, 'importDrafts', payload.id);
      if (draft.version !== payload.expectedVersion || draft.status !== 'draft') fail('CONFLICT');
      if (Date.parse(deps.now()) >= Date.parse(draft.cleanupAfter)) fail('DRAFT_EXPIRED');
      if (payload.reviewed !== true) fail('CONFIRMATION_REQUIRED');
      const choices = payload.choices;
      const existing = await tx.list(owner, 'tasks');
      if (!Array.isArray(choices) || choices.length !== draft.candidates.length) {
        if (draft.candidates.some(c => duplicateIds(c, existing).length)) fail('DUPLICATE_CHOICE_REQUIRED');
        fail('CONFIRMATION_REQUIRED');
      }
      if (new Set(choices.map(c => c.index)).size !== choices.length) fail('VALIDATION');
      const tasks = [];
      for (let index = 0; index < draft.candidates.length; index++) {
        const candidate = draft.candidates[index]; const choice = choices.find(c => c.index === index);
        if (!choice || !['save', 'merge', 'skip'].includes(choice.choice)) fail('DUPLICATE_CHOICE_REQUIRED');
        if (choice.choice === 'skip') continue;
        if (draft.boxes?.some(b => typeof b.confidence === 'number' && b.confidence < 80) && !choice.acknowledge?.includes('lowConfidence')) fail('CONFIRMATION_REQUIRED');
        const patch = choice.patch === undefined ? {} : choice.patch;
        if (!isObject(patch)) fail('VALIDATION');
        const merged = { ...candidate, ...patch };
        // A date may be explicitly left unknown. Other unresolved recognition fields
        // must be corrected rather than acknowledged into invented formal data.
        for (const field of candidate.needsConfirmation) {
          if (field === 'dueAt' && merged.dueAt === null && choice.acknowledge?.includes('dueAt')) continue;
          if (['referenceDate', 'dueText'].includes(field) && (patch.dueAt !== undefined || choice.acknowledge?.includes('dueAt'))) continue;
          if (field === 'schedule.weeks' && merged.schedule?.weeks?.length) continue;
          if (field === 'dueAt' && patch.dueAt !== undefined && patch.dueAt !== null) continue;
          fail('CONFIRMATION_REQUIRED');
        }
        let previous = null; let version = 0;
        if (choice.choice === 'merge') {
          const duplicates = duplicateIds(merged, existing);
          if (!duplicates.includes(choice.targetId)) fail('INVALID_REFERENCE');
          previous = await getRecord(tx, owner, 'tasks', choice.targetId); version = choice.expectedVersion;
          if (previous.version !== version) fail('CONFLICT');
        }
        const saved = await writeRecord(tx, owner, 'tasks', merged, previous, version, deps); tasks.push(saved);
        const found = existing.findIndex(t => t.id === saved.id); if (found === -1) existing.push(saved); else existing[found] = saved;
      }
      const confirmed = await tx.save(owner, 'importDrafts', { ...draft, status: 'confirmed', confirmedAt: deps.now(), taskIds: tasks.map(t => t.id) }, draft.version);
      return { draft: confirmed, tasks };
    });
    await releaseScreenshots(owner, deps);
    return result;
  }
  if (action === 'imports.markExpired') {
    const result = await deps.repository.transaction(owner, async tx => {
      const drafts = await tx.list(owner, 'importDrafts'); let count = 0;
      for (const draft of drafts) if (draft.status === 'draft' && Date.parse(deps.now()) >= Date.parse(draft.cleanupAfter)) {
        // Raw recognition material is discarded on expiry; ID/version remain for conflict handling.
        await tx.save(owner, 'importDrafts', { ...draft, status: 'expired', text: '', candidates: [], boxes: [], cleanupMarkedAt: deps.now() }, draft.version); count++;
      }
      return { count };
    });
    // Same explicit sweep releases expired or finished screenshots for this owner.
    return { ...result, uploads: await cleanupOwnerUploads(owner, deps) };
  }
  fail('UNKNOWN_ACTION');
}
module.exports = { handleImports, parseCandidate, duplicateIds };
