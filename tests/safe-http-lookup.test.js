'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');

test('public IPv4 remains allowed while mapped IPv6 and reserved destinations stay blocked',async()=>{
 const {isPublicAddress,safeRequest}=require('../cloudfunctions/api/adapters/safe-http');
 for(const ip of ['1.1.1.1','8.8.8.8','47.103.24.173','203.107.1.33','2606:4700:4700::1111'])assert.equal(isPublicAddress(ip),true,ip);
 for(const ip of ['0.1.2.3','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.0.0.1','192.0.2.1','192.168.1.1','198.18.0.46','198.19.255.255','198.51.100.1','203.0.113.1','224.0.0.1','240.0.0.1','255.255.255.255','::','::1','fc00::1','fe80::1','ff02::1','2001:db8::1','2001::1','2002:808:808::1','64:ff9b::808:808','::ffff:8.8.8.8','::ffff:127.0.0.1','::ffff:0808:0808','invalid'])assert.equal(isPublicAddress(ip),false,ip);
 await assert.rejects(safeRequest('https://example.com/',{lookup:async()=>[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}]}),/Unsafe destination/);
});
test('pinned DNS lookup honours the all:true contract used by Node 20 connection selection',()=>{
 const {pinnedLookup}=require('../cloudfunctions/api/adapters/safe-http');
 const address={address:'1.1.1.1',family:4};
 pinnedLookup(address)('example.com',{all:true},(error,result)=>{assert.equal(error,null);assert.deepEqual(result,[address]);});
 pinnedLookup(address)('example.com',{},(error,result,family)=>{assert.equal(error,null);assert.equal(result,address.address);assert.equal(family,4);});
});
