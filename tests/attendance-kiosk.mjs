import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/package.json');
const { chromium } = require('playwright');
const root = path.resolve(new URL('..',import.meta.url).pathname);
const server = http.createServer((req,res) => {
  const file = path.join(root,req.url.split('?')[0]);
  try {res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(fs.readFileSync(file));}
  catch {res.statusCode=404;res.end();}
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.on('listening',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const errors=[];
try {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  let mode='match',punches=0,statusCalls=0,faceCalls=0,lastRequest;
  await page.addInitScript(()=>{
    localStorage.machi_kiosk_token='test-device';
    const face=Array(128).fill(0);face[0]=1;
    window.faceapi={nets:{tinyFaceDetector:{loadFromUri:async()=>{}},faceLandmark68TinyNet:{loadFromUri:async()=>{}},faceRecognitionNet:{loadFromUri:async()=>{}}},TinyFaceDetectorOptions:class{},
      detectAllFaces(){return {withFaceLandmarks(){return {withFaceDescriptors:async()=>window.testNoFace?[]:[{descriptor:face}]};}};}};
  });
  await page.route('https://tejglrlkaqolbghoagqj.supabase.co/**',async route=>{
    const b=route.request().postDataJSON() || {}; lastRequest=b;
    const reply=x=>route.fulfill({json:x});
    if(route.request().method()==='GET')return reply({device_name:'試験端末',staff:[{id:1,display_name:'テストスタッフ'}]});
    if(b.action==='face_begin')return reply({attempt_id:'test-attempt',started_at:new Date().toISOString()});
    if(b.action==='face_identify'){faceCalls++;return reply({ok:true,person:mode==='match'?{id:1,display_name:'テストスタッフ'}:null});}
    if(b.action==='face_fallback')return reply({ok:true});
    if(b.action==='status'){
      statusCalls++;if(mode==='refresh-error'&&statusCalls>1)return route.fulfill({status:503,json:{error:'再取得エラー'}});
      return reply({person:{id:1,display_name:'テストスタッフ'},current:{working:false,on_break:false},shifts:[]});
    }
    if(b.action==='clock_in'){punches++;return reply({ok:true,shift:{clock_in:'2026-10-02T02:00:00Z'}});}
    if(b.action==='face_enroll')return reply({ok:true});
    return reply({ok:true});
  });
  await page.goto(origin+'/attendance-kiosk.html');
  await page.locator('#face-start').click();
  await page.locator('#pin-card:not(.hide)').waitFor();
  assert.equal(faceCalls,1);assert.equal(punches,0,'Recognizing a face cannot create a punch');
  await page.locator('#pin').fill('1234');await page.locator('#open').click();
  await page.locator('#actions:not(.hide)').waitFor();
  assert.equal(lastRequest.attempt_id,'test-attempt');
  // Enrollment requires explicit consent; then 3 descriptors, never image bytes.
  await page.locator('#face-enroll').click();
  assert.match(await page.locator('#face-message').textContent(),/同意/);
  await page.locator('#face-consent').check();await page.locator('#face-enroll').click();
  await page.waitForFunction(()=>document.getElementById('face-message').textContent.includes('登録しました'));
  assert.equal(lastRequest.descriptors.length,3);assert.equal('photo' in lastRequest,false);
  await page.locator('#lock').click();
  mode='refresh-error';statusCalls=0;
  await page.locator('.person').click();await page.locator('#pin').fill('1234');await page.locator('#open').click();
  await page.locator('#clock-in').click();
  await page.waitForFunction(()=>document.getElementById('msg').textContent.includes('再取得'));
  assert.match(await page.locator('#msg').textContent(),/出勤を記録しました/);
  assert.equal(punches,1);assert.match(await page.locator('#msg').getAttribute('class'),/ok/);
  // No match leaves the manual route usable.
  mode='no-match';await page.reload();await page.locator('#face-start').click();
  await page.waitForFunction(()=>document.getElementById('face-message').textContent.includes('下から選んで'));
  await page.locator('.person').click();await page.locator('#pin-card:not(.hide)').waitFor();
  // Slow inference times out; camera closes and PIN stays available.
  await page.reload();await page.evaluate(()=>window.testNoFace=true);
  await page.locator('#face-start').click();
  await page.waitForFunction(()=>document.getElementById('face-message').textContent.includes('確認できなくても'),{},{timeout:10000});
  assert.equal(await page.locator('#face-video').evaluate(x=>x.srcObject),null);
  await page.locator('.person').click();await page.locator('#pin-card:not(.hide)').waitFor();
  // Camera permission denial does not block manual punching.
  await page.reload();await page.evaluate(()=>navigator.mediaDevices.getUserMedia=async()=>{throw Error('denied')});
  await page.locator('#face-start').click();
  await page.waitForFunction(()=>document.getElementById('face-message').textContent.includes('確認できなくても'));
  await page.locator('.person').click();await page.locator('#pin-card:not(.hide)').waitFor();
  assert.deepEqual(errors,[]);
  // Load the real pinned library and model manifests/shards in the browser.
  await page.goto(origin+'/attendance-kiosk.html');
  await page.addScriptTag({url:origin+'/vendor/face-api/face-api.min.js'});
  await page.evaluate(async()=>{await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri('/vendor/face-api/models'),faceapi.nets.faceLandmark68TinyNet.loadFromUri('/vendor/face-api/models'),faceapi.nets.faceRecognitionNet.loadFromUri('/vendor/face-api/models')]);});
  await page.screenshot({path:'/workspace/scratch/643123b7b118/attendance-preview.png',fullPage:true});
  console.log('PASS: face match needs PIN, enrollment consent + 3 descriptors, saved punch survives refresh failure, no-match/3-second timeout/camera-denied fallback, camera shutdown, real library/model loading.');
} finally {await browser.close();server.close();}
