import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.ATTENDANCE_TEST_MODULES + '/package.json');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(new URL('../attendance-kiosk.html', import.meta.url),'utf8');
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
const faceScript = fs.readFileSync(new URL('../attendance-face.js',import.meta.url),'utf8');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(check) {for(let i=0;i<300;i++){if(check())return;await sleep(10);}throw Error('UI did not reach expected state');}
async function fixture(mode='match') {
  const dom=new JSDOM(html,{url:'https://kiosk.test/attendance-kiosk.html',runScripts:'outside-only'});
  const w=dom.window,$=id=>w.document.getElementById(id),calls=[];let stops=0,statuses=0;
  w.localStorage.machi_kiosk_token='test-device';w.AbortController=AbortController;
  // Time-bound failure paths run quickly without altering production timing.
  const nativeTimeout=w.setTimeout.bind(w);
  w.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,[3000,8000,10000,12000].includes(ms)?100:ms,...args);
  const descriptor=Array(128).fill(0);descriptor[0]=1;
  w.faceapi={nets:{tinyFaceDetector:{loadFromUri:async()=>{}},faceLandmark68TinyNet:{loadFromUri:async()=>{}},faceRecognitionNet:{loadFromUri:async()=>{}}},TinyFaceDetectorOptions:class{},detectAllFaces(){return {withFaceLandmarks(){return {withFaceDescriptors:()=>mode==='slow'?new Promise(()=>{}):Promise.resolve([{descriptor}])};}};}};
  Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>{if(mode==='denied')throw Error('camera denied');return {getTracks:()=>[{stop(){stops++;}}]};}}});
  $('face-video').play=async()=>{};
  w.fetch=async(url,options={})=>{
    const b=options.body?JSON.parse(options.body):{};calls.push(b);
    const reply=(body,status=200)=>({ok:status<400,status,json:async()=>body});
    if(options.method==='GET')return reply({device_name:'テスト端末',staff:[{id:1,display_name:'試験スタッフ'}]});
    if(b.action==='face_begin')return reply({attempt_id:'attempt',started_at:new Date().toISOString()});
    if(b.action==='face_identify')return reply({ok:true,person:mode==='no-match'?null:{id:1,display_name:'試験スタッフ'}});
    if(b.action==='status'){
      statuses++;if(mode==='refresh-failed'&&statuses>1)return reply({error:'現在状態取得エラー'},503);
      return reply({person:{id:1,display_name:'試験スタッフ'},current:{working:false,on_break:false},shifts:[]});
    }
    if(b.action==='clock_in')return reply({ok:true,shift:{clock_in:'2026-10-02T02:00:00Z'}});
    return reply({ok:true});
  };
  w.eval(faceScript);w.eval(inline);
  await until(()=>w.document.querySelector('.person'));
  return {w,$,calls,dom,stops:()=>stops};
}
for (const mode of ['match','no-match','slow','denied']) {
  const f=await fixture(mode);
  try {
    f.$('face-start').click();
    await until(()=>mode==='match'?!f.$('pin-card').classList.contains('hide'):f.$('face-message').textContent.includes(mode==='no-match'?'下から':'確認できなくても'));
    assert.equal(f.calls.some(x=>x.action==='clock_in'),false,'Face match never bypasses PIN');
    if(mode!=='match')f.w.document.querySelector('.person').click();
    f.$('pin').value='1234';f.$('open').click();
    await until(()=>!f.$('actions').classList.contains('hide'));
    assert.equal(f.calls.find(x=>x.action==='status').attempt_id,'attempt');
    if(mode==='match') {
      f.$('face-enroll').click();assert.match(f.$('face-message').textContent,/同意/);
      f.$('face-consent').checked=true;f.$('face-enroll').click();
      await until(()=>f.calls.some(x=>x.action==='face_enroll'));
      const b=f.calls.find(x=>x.action==='face_enroll');assert.equal(b.descriptors.length,3);assert.equal('photo' in b,false);
    }
    if(mode==='slow')assert.equal(f.$('face-video').srcObject,null);
  } finally {f.dom.window.close();}
}
const f=await fixture('refresh-failed');
try {
  f.w.document.querySelector('.person').click();f.$('pin').value='1234';f.$('open').click();
  await until(()=>!f.$('actions').classList.contains('hide'));
  f.$('clock-in').click();f.$('clock-in').click();
  await until(()=>f.$('msg').textContent.includes('再取得'));
  assert.match(f.$('msg').textContent,/出勤を記録しました/);assert.equal(f.$('msg').classList.contains('ok'),true);
  assert.equal(f.calls.filter(x=>x.action==='clock_in').length,1,'Duplicate click blocked');
}finally{f.dom.window.close();}
console.log('PASS: face-assisted name + mandatory PIN, enrollment consent + three descriptors, no-match/timeout/camera denial preserve PIN route, camera released, saved punch remains success after refresh failure, double-click blocked.');
