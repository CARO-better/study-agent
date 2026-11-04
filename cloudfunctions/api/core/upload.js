'use strict';
const { createHash } = require('node:crypto');
const { fail } = require('./errors');

// One ticket authorizes exactly one upload and one recognition window.
const TICKET_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_ENCODED_LENGTH = 6 * 1024 * 1024;
const CONTENT_TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png' });
const MAGIC = Object.freeze({ jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] });

function storagePrefix(deps) {
  if (!deps.cloudEnvId || typeof deps.cloudFilePrefix !== 'string'
    || !deps.cloudFilePrefix.startsWith(`cloud://${deps.cloudEnvId}.`)
    || !/^cloud:\/\/[a-zA-Z0-9.-]+$/.test(deps.cloudFilePrefix)) fail('OCR_UNCONFIGURED');
  return deps.cloudFilePrefix;
}

function sniffImage(bytes) {
  for (const [type, magic] of Object.entries(MAGIC)) {
    if (bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte)) return type;
  }
  return null;
}

function decodeBase64(value) {
  if (typeof value !== 'string') fail('VALIDATION');
  const body = value.trim().replace(/^data:image\/[a-z]+;base64,/i, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = body.endsWith('=') ? body : body + '='.repeat((4 - (body.length % 4)) % 4);
  if (!padded || padded.length > MAX_ENCODED_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) fail('VALIDATION');
  return Buffer.from(padded, 'base64');
}

// Only real JPEG/PNG bodies are accepted, so a ticket cannot become arbitrary
// file storage and OCR never receives a payload it cannot read.
function decodeImage(value) {
  const bytes = decodeBase64(value);
  const type = sniffImage(bytes);
  if (!type || bytes.length > MAX_IMAGE_BYTES) fail('VALIDATION');
  return { bytes, type };
}

// A ticket id is a logical id, never a storage path: the caller cannot choose
// where bytes are written, and the path always stays under the owner hash.
function readTicketId(payload) {
  if (typeof payload.ticketId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.ticketId)) fail('VALIDATION');
  return payload.ticketId;
}

function usable(ticket, now) {
  return Boolean(ticket) && ticket.status === 'active' && !ticket.uploadedAt && Date.parse(now) < Date.parse(ticket.cleanupAfter);
}

// Recognition is only allowed for bytes that already passed the server upload
// check, so a prepared-but-unused ticket cannot pull an arbitrary storage
// object, and a client cannot hand the OCR service bytes it never validated.
async function requireUploadedTicket(owner, fileId, deps) {
  if (typeof fileId !== 'string' || !fileId || fileId.length > 1024) fail('VALIDATION');
  const tickets = await deps.repository.list(owner, 'uploadTickets');
  const ticket = tickets.find(item => item.fileId === fileId && item.status === 'active' && item.uploadedAt
    && Date.parse(deps.now()) < Date.parse(item.cleanupAfter));
  if (!ticket) fail('NOT_FOUND');
  return ticket;
}

async function prepareUpload({ owner, payload }, deps) {
  const contentType = String(payload.contentType === undefined ? 'image/jpeg' : payload.contentType).toLowerCase();
  const extension = CONTENT_TYPES[contentType];
  if (!extension) fail('VALIDATION');
  const filePrefix = storagePrefix(deps);
  const id = deps.newId();
  const cloudPath = `imports/${createHash('sha256').update(owner).digest('hex')}/${id}.${extension}`;
  const cleanupAfter = new Date(Date.parse(deps.now()) + TICKET_LIFETIME_MS).toISOString();
  const ticket = await deps.repository.save(owner, 'uploadTickets', {
    id, cloudPath, fileId: `${filePrefix}/${cloudPath}`, extension, contentType, status: 'active', cleanupAfter
  }, 0);
  return { ticketId: ticket.id, cloudPath, fileId: ticket.fileId, expiresAt: cleanupAfter };
}

async function upload({ owner, payload }, deps) {
  const id = readTicketId(payload);
  const ticket = await deps.repository.get(owner, 'uploadTickets', id);
  // Another owner's ticket, an expired ticket and an already used ticket are
  // deliberately indistinguishable from a missing one.
  if (!usable(ticket, deps.now())) fail('NOT_FOUND');
  const { bytes, type } = decodeImage(payload.base64);
  if (type !== ticket.extension) fail('VALIDATION');
  if (!deps.cloud || typeof deps.cloud.uploadFile !== 'function') fail('INTERNAL');
  const stored = await deps.cloud.uploadFile({ cloudPath: ticket.cloudPath, fileContent: bytes });
  if (!stored || stored.fileID !== ticket.fileId) fail('INTERNAL');
  // The storage write cannot live inside the transaction, so the ticket is
  // consumed afterwards and a concurrent upload loses here instead.
  await deps.repository.transaction(owner, async tx => {
    const current = await tx.get(owner, 'uploadTickets', id);
    if (!usable(current, deps.now())) fail('NOT_FOUND');
    await tx.save(owner, 'uploadTickets', { ...current, uploadedAt: deps.now(), byteSize: bytes.length }, current.version);
  });
  return { ticketId: id, fileId: ticket.fileId, byteSize: bytes.length, contentType: ticket.contentType };
}

async function handleUpload({ owner, action, payload }, deps) {
  if (action === 'imports.prepareUpload') return prepareUpload({ owner, payload }, deps);
  if (action === 'imports.upload') return upload({ owner, payload }, deps);
  fail('UNKNOWN_ACTION');
}

module.exports = { handleUpload, prepareUpload, upload, requireUploadedTicket, decodeImage };
