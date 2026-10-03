import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const faceapi=require('../vendor/face-api/face-api.min.js');
const folder=new URL('../vendor/face-api/models/',import.meta.url);
const localFetch=async url=>{
  const name=String(url).split('/').pop();
  return new Response(fs.readFileSync(new URL(name,folder)),{status:200});
};
globalThis.fetch=localFetch;
faceapi.env.monkeyPatch({fetch:localFetch});
await Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
  faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models'),
  faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
]);
const input=faceapi.tf.zeros([150,150,3]);
try {
  const descriptor=await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(input);
  assert.equal(descriptor.length,128);assert.equal(Array.from(descriptor).every(Number.isFinite),true);
}finally{input.dispose();}
console.log('PASS: pinned library loads all three model manifests/shards and computes a finite 128-dimensional descriptor from a synthetic tensor. Real camera/identity accuracy requires device testing.');
