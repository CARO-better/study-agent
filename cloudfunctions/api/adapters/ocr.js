'use strict';
const crypto = require('node:crypto');
const { safeRequest } = require('./safe-http');
const { fail } = require('../core/errors');
const { requireUploadedTicket } = require('../core/upload');

const HOST = 'ocr.tencentcloudapi.com';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BOXES = 1000;
const MAX_BOX_CHARS = 200;
const MAX_TEXT_CHARS = 50000;

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value, encoding) => crypto.createHmac('sha256', key).update(value).digest(encoding);

// OCR is billed per call and the text-model key never covers it, so each owner
// gets a bounded number of recognitions per China calendar day.
async function countOcrCall(owner, deps) {
  const day = new Date(Date.parse(deps.now()) + 8 * 3600000).toISOString().slice(0, 10);
  const id = `ocr_day_${day.replaceAll('-', '')}`;
  await deps.repository.transaction(owner, async tx => {
    const previous = await tx.get(owner, 'providerUsage', id);
    const count = previous?.count || 0;
    if (count >= Math.min(deps.ocrDailyLimit || 20, 60)) fail('USAGE_LIMIT');
    await tx.save(owner, 'providerUsage', { id, count: count + 1 }, previous?.version || 0);
  });
}

function signRequest({ secretId, secretKey, region, body }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const day = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const scope = `${day}/ocr/tc3_request`;
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${HOST}\n\ncontent-type;host\n${hash(body)}`;
  const toSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`;
  const signing = hmac(hmac(hmac(`TC3${secretKey}`, day), 'ocr'), 'tc3_request');
  const signature = hmac(signing, toSign, 'hex');
  return {
    timestamp,
    region,
    authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`
  };
}

async function extractScreenshot({ owner, fileId }, deps) {
  await requireUploadedTicket(owner, fileId, deps);
  if (!deps.cloud || !deps.ocrSecretId || !deps.ocrSecretKey) fail('OCR_UNCONFIGURED');
  const result = await deps.cloud.downloadFile({ fileID: fileId });
  const bytes = result.fileContent;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) fail('VALIDATION');
  await countOcrCall(owner, deps);
  const body = JSON.stringify({ ImageBase64: bytes.toString('base64') });
  const { timestamp, region, authorization } = signRequest({ secretId: deps.ocrSecretId, secretKey: deps.ocrSecretKey, region: deps.ocrRegion || 'ap-guangzhou', body });
  const response = await (deps.ocrRequest || safeRequest)(`https://${HOST}/`, {
    method: 'POST',
    maxBytes: 1048576,
    maxRequestBytes: 8 * 1024 * 1024,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      host: HOST,
      'x-tc-action': 'GeneralBasicOCR',
      'x-tc-version': '2018-11-19',
      'x-tc-region': region,
      'x-tc-timestamp': String(timestamp),
      authorization
    },
    body
  });
  if (!response.ok) fail('OCR_FAILED');
  const data = await response.json();
  if (data.Response?.Error || !Array.isArray(data.Response?.TextDetections)) fail('OCR_FAILED');
  // Boxes are kept bounded: a single draft document must stay far below the
  // 1MB document limit, and updateDraft only accepts 50k characters of text.
  const boxes = data.Response.TextDetections.slice(0, MAX_BOXES).map(item => ({
    text: String(item.DetectedText || '').slice(0, MAX_BOX_CHARS),
    confidence: typeof item.Confidence === 'number' ? item.Confidence : null,
    polygon: item.Polygon || []
  }));
  const text = boxes.map(box => box.text).join('\n').slice(0, MAX_TEXT_CHARS);
  return { text, boxes, warnings: boxes.some(box => box.confidence !== null && box.confidence < 80) ? ['存在低置信度文字，请逐项检查'] : [] };
}

module.exports = { extractScreenshot };
