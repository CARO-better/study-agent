'use strict';
const crypto = require('node:crypto');
const { safeRequest } = require('./safe-http');
const { fail } = require('../core/errors');

const NAV = 'https://api.bilibili.com/x/web-interface/nav';
const SEARCH = 'https://api.bilibili.com/x/web-interface/wbi/search/type';
// Fixed WBI mixin permutation published by the web client. It can change, so a
// failed signature surfaces as BILI_UNAVAILABLE instead of a wrong result.
const MIXIN_TABLE = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

const md5 = value => crypto.createHash('md5').update(value).digest('hex');
const plain = value => String(value || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

function wbiKey(url) {
  const name = String(url || '').split('/').pop().split('.')[0];
  if (!/^[0-9a-f]{32}$/.test(name)) fail('BILI_UNAVAILABLE');
  return name;
}

function mixinKey(imgKey, subKey) {
  const source = imgKey + subKey;
  return MIXIN_TABLE.map(index => source[index]).join('').slice(0, 32);
}

function signQuery(params, mixin) {
  const query = Object.keys(params).sort().map(key => `${key}=${encodeURIComponent(params[key])}`).join('&');
  return `${query}&w_rid=${md5(query + mixin)}`;
}

function durationSeconds(value) {
  const parts = String(value || '').split(':').map(Number);
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

async function getJson(url, deps) {
  const request = deps.biliRequest || safeRequest;
  let response;
  try {
    response = await request(url, {
      method: 'GET',
      maxBytes: 512 * 1024,
      timeout: 10000,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; study-agent/0.1)',
        referer: 'https://www.bilibili.com/',
        ...(deps.biliCookie ? { cookie: deps.biliCookie } : {})
      }
    });
  } catch { fail('BILI_UNAVAILABLE'); }
  if (!response || !response.ok) fail('BILI_UNAVAILABLE');
  try { return await response.json(); } catch { fail('BILI_UNAVAILABLE'); }
}

// Real search results only: every item carries an actual bvid and a canonical
// URL. Nothing is synthesised when Bilibili refuses the request.
async function searchVideos({ keyword, limit = 8 }, deps) {
  if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 100) fail('VALIDATION');
  const size = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const nav = await getJson(NAV, deps);
  const images = nav && nav.data && nav.data.wbi_img;
  if (!images || !images.img_url || !images.sub_url) fail('BILI_UNAVAILABLE');
  const mixin = mixinKey(wbiKey(images.img_url), wbiKey(images.sub_url));
  const query = signQuery({
    search_type: 'video', keyword: keyword.trim(), page: 1, page_size: size, wts: Math.floor(Date.now() / 1000)
  }, mixin);
  const body = await getJson(`${SEARCH}?${query}`, deps);
  if (!body || body.code !== 0 || !body.data || !Array.isArray(body.data.result)) fail('BILI_UNAVAILABLE');
  const items = body.data.result
    .filter(item => item && typeof item.bvid === 'string' && item.bvid && item.title)
    .map(item => ({
      bvid: item.bvid,
      title: plain(item.title),
      author: plain(item.author),
      url: `https://www.bilibili.com/video/${item.bvid}`,
      durationSeconds: durationSeconds(item.duration),
      play: Number.isFinite(item.play) ? item.play : null,
      publishedAt: Number.isFinite(item.pubdate) ? new Date(item.pubdate * 1000).toISOString() : null,
      description: plain(item.description).slice(0, 200)
    }));
  return { keyword: keyword.trim(), items, fetchedAt: (deps.now || (() => new Date().toISOString()))() };
}

module.exports = { searchVideos, mixinKey, signQuery, plain, durationSeconds, MIXIN_TABLE };
