// Run only against a temporary synthetic staff/device fixture; never actual employee data.
import assert from 'node:assert/strict';
const API=process.env.ATTENDANCE_TEST_API;
const token=process.env.ATTENDANCE_TEST_TOKEN;
const staff=Number(process.env.ATTENDANCE_TEST_STAFF);
if(!API||!token||!staff)throw Error('Temporary test fixture variables are required');
async function call(body,key=token){
  const response=await fetch(API,{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(key?{'x-kiosk-token':key}:{})},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
const descriptor=Array(128).fill(0);descriptor[0]=1;
const auth={staff_id:staff,pin:'739251'};
const model='face-api-0.22.2-recognition-v1';
assert.equal((await call({action:'face_begin'},'')).status,401);
assert.equal((await call({action:'face_attempts'})).status,401);
assert.equal((await call({action:'face_enroll',staff_id:staff,pin:'111111',consent:true,model,descriptors:[descriptor,descriptor,descriptor]})).status,401);
assert.equal((await call({action:'face_enroll',...auth,consent:false,model,descriptors:[descriptor,descriptor,descriptor]})).status,400);
assert.equal((await call({action:'face_enroll',...auth,consent:true,model,descriptors:[descriptor,descriptor,descriptor]})).body.ok,true);
const start=await call({action:'face_begin'});assert.equal(start.status,200);assert.ok(start.body.started_at);
const identification=await call({action:'face_identify',attempt_id:start.body.attempt_id,model,descriptor});
assert.equal(identification.status,200);assert.equal(identification.body.person.id,staff);
assert.equal('descriptors' in identification.body,false);
assert.equal((await call({action:'face_identify',attempt_id:start.body.attempt_id,model,descriptor})).status,409);
const status=await call({action:'status',...auth,attempt_id:start.body.attempt_id});
assert.equal(status.status,200);assert.equal(status.body.current.working,false,'Face identification must not start a shift');
assert.equal((await call({action:'face_delete',...auth})).body.ok,true);
const unmatched=await call({action:'face_begin'});
const miss=await call({action:'face_identify',attempt_id:unmatched.body.attempt_id,model,descriptor});
assert.equal(miss.body.person,null);
const manual=await call({action:'face_begin'});
assert.equal((await call({action:'face_fallback',attempt_id:manual.body.attempt_id,reason:'timeout'})).body.ok,true);
console.log('PASS: live API rejects missing kiosk / kiosk-only manager access / wrong PIN / missing consent; synthetic enrollment, scoped face match, no template exposure, replay rejected, PIN verifies identity without punching, deletion, no-match and timeout logs.');
