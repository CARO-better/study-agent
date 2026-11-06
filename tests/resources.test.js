'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../cloudfunctions/api');
const { createMemoryRepository } = require('../cloudfunctions/api/adapters/repository');
const { searchVideos } = require('../cloudfunctions/api/adapters/bilibili');
const { rankItems, keywordFor, pickTargets } = require('../cloudfunctions/api/core/resources');

const IMG = 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png';
const SUB = 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png';
const NAV = { code: 0, data: { wbi_img: { img_url: IMG, sub_url: SUB } } };
const item = (overrides = {}) => ({
  bvid: 'BV1xx411c7mD', title: '<em class="keyword">高数</em>期末复习', author: 'up', play: 12000,
  duration: '12:34', pubdate: 1793785000, description: '重点串讲', ...overrides
});

function searchStub(result, seen = []) {
  return async (url) => {
    seen.push(url);
    const body = url.includes('/wbi/search/type') ? { code: 0, data: { result } } : NAV;
    return { ok: true, status: 200, json: async () => body };
  };
}

test('bilibili search signs the request and returns real items only', async () => {
  const seen = [];
  const found = await searchVideos({ keyword: '高等数学 极限', limit: 5 }, { biliRequest: searchStub([item()], seen) });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].title, '高数期末复习');
  assert.equal(found.items[0].url, 'https://www.bilibili.com/video/BV1xx411c7mD');
  assert.equal(found.items[0].durationSeconds, 754);
  const url = seen.find(entry => entry.includes('/wbi/search/type'));
  assert.match(url, /[?&]wts=\d+/);
  assert.match(url, /&w_rid=[0-9a-f]{32}$/);
  assert.ok(url.includes(encodeURIComponent('高等数学 极限')));
});

test('bilibili failure never produces fabricated links', async () => {
  const refusing = async () => ({ ok: true, status: 200, json: async () => ({ code: -412, message: 'risk control' }) });
  await assert.rejects(searchVideos({ keyword: '线代' }, { biliRequest: refusing }), error => error.code === 'BILI_UNAVAILABLE');
  const offline = async () => { throw Error('network'); };
  await assert.rejects(searchVideos({ keyword: '线代' }, { biliRequest: offline }), error => error.code === 'BILI_UNAVAILABLE');
});

test('bilibili errors identify the failed stage without exposing upstream secrets',async()=>{
 const cases=[
  {request:async()=>({ok:false,status:412}),message:/获取签名：HTTP 412/},
  {request:async()=>{throw Error('network COOKIE_SECRET keyword_secret');},message:/获取签名：网络请求失败/},
  {request:async url=>({ok:true,status:200,json:async()=>url.includes('/nav')?NAV:{code:-412,message:'COOKIE_SECRET keyword_secret'}}),message:/搜索视频：接口代码 -412/}
 ];
 for(const c of cases)await assert.rejects(searchVideos({keyword:'keyword_secret'},{biliRequest:c.request}),error=>{
  assert.equal(error.code,'BILI_UNAVAILABLE');assert.match(error.message,c.message);assert.doesNotMatch(error.message,/COOKIE_SECRET|keyword_secret/);return true;
 });
});

test('ranking prefers material that matches the scope and fits remaining time', () => {
  const ranked = rankItems([
    item({ bvid: 'BVlong', title: '高等数学 全套课程 3小时', durationSeconds: 10800, play: 900000 }),
    item({ bvid: 'BVshort', title: '高等数学 极限 20分钟速成', durationSeconds: 1200, play: 5000 })
  ], { terms: ['高等数学'], budgetMinutes: 30 });
  assert.equal(ranked[0].bvid, 'BVshort');
  assert.ok(ranked[0].reasons.includes('时长在剩余时间内'));
  assert.ok(ranked[0].score > ranked[1].score);
});

test('recommend searches per exam task using course and exam scope only', async () => {
  const repository = createMemoryRepository();
  const deps = { repository, newId: (() => { let n = 0; return () => `r${++n}`; })(), now: () => '2026-11-04T00:00:00.000Z' };
  const call = (action, payload) => api.handleAction({ owner: 'alice', action, payload }, deps);
  const course = (await call('courses.create', { record: { name: '高等数学', semesterId: 's1' } }));
  assert.equal(course.ok, false, 'course needs an existing semester');
  await call('semesters.create', { record: { name: '2026秋', startDate: '2026-09-01', endDate: '2027-01-15', teachingWeeks: 18 } });
  const semester = (await call('semesters.list', {})).data[0];
  const created = (await call('courses.create', { record: { name: '高等数学', semesterId: semester.id } })).data;
  await call('tasks.create', { record: { title: '期末', type: 'exam', remainingMinutes: 30, courseId: created.id, examScope: ['极限', '导数'], mastery: 'low' } });

  const keywords = [];
  deps.searchVideos = async ({ keyword }) => { keywords.push(keyword); return { keyword, fetchedAt: '2026-11-04T00:00:00.000Z', items: [item()] }; };
  const result = await call('resources.recommend', {});
  assert.equal(result.ok, true);
  assert.equal(result.data.source, 'bilibili-search');
  assert.equal(result.data.results.length, 1);
  assert.match(keywords[0], /高等数学/);
  assert.match(keywords[0], /极限/);
  assert.equal(result.data.results[0].items[0].bvid, 'BV1xx411c7mD');
});

test('search requires a keyword and recommend handles an empty board', async () => {
  const repository = createMemoryRepository();
  const deps = { repository, newId: () => 'r1', now: () => '2026-11-04T00:00:00.000Z' };
  const call = (action, payload) => api.handleAction({ owner: 'alice', action, payload }, deps);
  assert.equal((await call('resources.search', { keyword: '  ' })).error.code, 'VALIDATION');
  const empty = await call('resources.recommend', {});
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.data.results, []);
});

test('keyword and target selection use user data, not guesses', () => {
  assert.equal(keywordFor({ title: '实验报告', examScope: null }, null), '实验报告');
  assert.equal(keywordFor({ title: '期末', examScope: ['极限'] }, { name: '高等数学' }), '高等数学 极限');
  const targets = pickTargets([
    { id: 'a', type: 'assignment', priority: 'high', dueAt: '2026-11-05' },
    { id: 'b', type: 'exam', priority: 'low', dueAt: '2026-11-20' },
    { id: 'c', type: 'assignment', priority: 'high', dueAt: '2026-11-04' }
  ], 2);
  assert.deepEqual(targets.map(task => task.id), ['b', 'c']);
});

test('snapshot recommendations use the current app IDs and course scope without legacy records',async()=>{
  const repository=createMemoryRepository(),keywords=[];
  const deps={repository,now:()=> '2026-11-06T08:00:00.000Z',searchVideos:async({keyword})=>{keywords.push(keyword);return {fetchedAt:'2026-11-06T08:00:00Z',items:[item()]};}};
  const call=(action,payload)=>api.handleAction({owner:'alice',action,payload},deps);
  const store={courses:[{id:'local-course',name:'高等数学',importance:'high',mastery:'low'}],tasks:[{id:'local-task',courseId:'local-course',title:'期末复习',type:'exam',status:'open',remainingMinutes:30,examScope:'极限，导数'}],availability:[],blocks:[],unscheduled:[],previous:null};
  assert.equal((await call('sync.push',{store,expectedRevision:0})).ok,true);
  const result=await call('resources.recommendSnapshot',{taskIds:['local-task']});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.results[0].taskId,'local-task');
  assert.match(keywords[0],/高等数学.*极限/);
  assert.deepEqual(await repository.list('alice','tasks'),[]);
});
