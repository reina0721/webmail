import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeStalwart} from '../frontend/apps/web/src/platform/host/stalwart-origin.ts';

test('service origins preserve HTTPS ports without accepting credentials or unrelated paths',()=>{
 assert.equal(normalizeStalwart('mail.example.com:8443'),'https://mail.example.com:8443');
 assert.equal(normalizeStalwart('https://mail.example.com/admin/'),'https://mail.example.com');
 assert.equal(normalizeStalwart('https://mail.example.com/account'),'https://mail.example.com');
 for(const value of ['http://mail.example.com','https://user:key@mail.example.com','https://mail.example.com/jmap/','https://mail.example.com/?token=secret','javascript:alert(1)','https://mail.example.com/#secret'])assert.equal(normalizeStalwart(value),'');
});

test('automatic setup documentation covers the unified console and recovery steps',async()=>{
 const doc=await readFile(new URL('../docs/stalwart-setup.md',import.meta.url),'utf8');
 for(const identity of ['Secret','Key ID','账号 ID','安装管理令牌','API Keys','MTA Hook','Turnstile'])assert.ok(doc.includes(identity));
 assert.ok(doc.includes('/console/setup/'));
});
