const assert=require('node:assert/strict');
const {parseReport,TEMPLATE}=require('../inventory-text-parser.js');
const sample=`9/20白木原  よる
【冷蔵庫仕込み在庫】
青ネギ:0.8（カットなし 3束)
半熟卵: 8
高菜 :2
高菜在庫:3
【メイン食材在庫】
生卵:1段目
【備品】
紙エプロン:2(23個)
※食材、備品等残り僅かな物↓記載
赤いゴミ袋
麺65`;
const result=parseReport(sample);
assert.deepEqual(result.header,{month:9,day:20,store:'白木原店',session:'night'});
assert.equal(result.unknown.length,0);
assert.equal(result.rows.length,8);
assert.equal(result.rows.find(x=>x.name==='青ネギ（カット済）').quantity,0.8);
assert.equal(result.rows.find(x=>x.name==='青ネギ（カット済）').detail,'カットなし 3束');
assert.equal(result.rows.find(x=>x.name==='生卵').status,'1段目');
assert.equal(result.rows.find(x=>x.name==='紙エプロン').detail,'23個');
assert.equal(result.rows.find(x=>x.name==='赤いゴミ袋').attention,true);
assert.equal(result.rows.find(x=>x.name==='麺').quantity,65);
assert.notEqual(result.rows.find(x=>x.name==='高菜（カット・炒め済）').name,result.rows.find(x=>x.name==='高菜漬け（未仕込み）').name);
assert(TEMPLATE.items.length>=44);

const nagahama=parseReport(`9/21昼スタッフへ
【仕込み在庫】
半熟卵:17個
【在庫】
卵:5P+6個
高菜:6P×3
キクラゲ:大1
米:3.5K
麺:90玉
【買い出し、補充等依頼】
餃子のタレ`,{template:'nagahama',store:'長浜店'});
assert.deepEqual(nagahama.header,{month:9,day:21,store:'長浜店',session:'midday'});
assert.equal(nagahama.unknown.length,0);
assert.equal(nagahama.rows.find(x=>x.name==='半熟卵').quantity,17);
assert.equal(nagahama.rows.find(x=>x.name==='半熟卵').unit,'個');
assert.equal(nagahama.rows.find(x=>x.name==='生卵').quantity,null);
assert.equal(nagahama.rows.find(x=>x.name==='生卵').status,'5P+6個');
assert.equal(nagahama.rows.find(x=>x.name==='高菜（カット・炒め済）').status,'6P×3');
assert.equal(nagahama.rows.find(x=>x.name==='米').unit,'K');
assert.equal(nagahama.rows.find(x=>x.name==='麺').quantity,90);
assert.equal(nagahama.rows.find(x=>x.name==='餃子のタレ').attention,true);
console.log('inventory parser tests passed:',result.summary,nagahama.summary);
