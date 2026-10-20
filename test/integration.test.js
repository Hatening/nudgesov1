import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {stopChildAndRemove} from '../test-support/cleanup.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function freePort(){return await new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});s.on('error',reject);});}
async function waitFor(url,child){for(let i=0;i<60;i++){if(child.exitCode!==null)throw new Error('server exited before ready');try{const r=await fetch(url);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('server did not become ready');}
test('HTTP API smoke: health, bootstrap, knowledge create, chat and regression run',async(t)=>{
 const port=await freePort();const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'relaydesk-test-'));
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dataDir,OLLAMA_URL:'',APP_API_KEY:''},stdio:'ignore'});
 t.after(async()=>{await stopChildAndRemove(child,dataDir);});
 const base=`http://127.0.0.1:${port}`;await waitFor(`${base}/api/health`,child);
 const health=await (await fetch(`${base}/api/health`)).json();assert.equal(health.ok,true);
 const register=await fetch(`${base}/api/v1/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`qa-int-${Date.now()}@example.test`,password:'TestPass123!'})});assert.equal(register.status,201);
 const {token}=await register.json();
 const auth={authorization:`Bearer ${token}`,'content-type':'application/json'};
 const boot=await (await fetch(`${base}/api/bootstrap`,{headers:auth})).json();assert.ok(boot.knowledge.length>=3);
 const create=await fetch(`${base}/api/knowledge`,{method:'POST',headers:auth,body:JSON.stringify({title:'Integration test article',content:'Test content for a custom product return process.',language:'en',type:'faq'})});assert.equal(create.status,201);
 const chat=await fetch(`${base}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'Where is my shipping tracking?',language:'en'})});assert.equal(chat.status,200);const answer=await chat.json();assert.ok(answer.result.answer);assert.ok(Array.isArray(answer.result.evidence));
 const run=await fetch(`${base}/api/test/run`,{method:'POST',headers:auth,body:'{}'});assert.equal(run.status,200);const testRun=await run.json();assert.equal(testRun.run.total,5);assert.equal(testRun.run.passed,5);
 const bad=await fetch(`${base}/api/knowledge`,{method:'POST',headers:auth,body:JSON.stringify({title:'',content:''})});assert.equal(bad.status,400);
});
