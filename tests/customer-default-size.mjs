import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
const groups=[{id:1,name:'麺量（通常）',required:true,min_select:1,max_select:1,options:[{id:1,name:'半玉',price_delta:-200},{id:2,name:'普通',price_delta:0},{id:3,name:'大盛',price_delta:0},{id:4,name:'W玉',price_delta:200}]},{id:8,name:'追加トッピング',options:[{id:88,name:'卵',price_delta:100}]}];
const c={pendingKey:"test",sending:false,localStorage:{getItem:()=>null},$:()=>({remove(){},querySelector:()=>({scrollTop:0,scrollLeft:0})}),data:{products:[{id:1,category_id:1},{id:2,category_id:2}]},isTopping:()=>false,productGroups:()=>groups,drawProduct(){},window:{}};
vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../customer-options.js',import.meta.url),'utf8'),c);c.CustomerOptions=c.window.CustomerOptions;
vm.runInContext('let current,editingItem,selected,quantity;'+html.slice(html.indexOf('    function pick('),html.indexOf('    function linkedTopping('))+html.slice(html.indexOf('    function toggleOption('),html.indexOf('    function addItem('))+'\nfunction choices(){return selected}',c);
c.pick(1);assert.equal(c.choices()[1].join(','),'2');assert.equal(c.choices()[8].length,0);assert.equal(c.CustomerOptions.validate(groups,c.choices()),'');
c.toggleOption(1,2);assert.equal(c.choices()[1].join(','),'2');
for(const id of [1,3,4,2]){c.toggleOption(1,id);assert.equal(c.choices()[1].join(','),String(id));}
c.pick(1);assert.equal(c.choices()[1].join(','),'2');
c.pick(2);assert.equal(c.choices()[1].length,0);
groups[0].options[1].available=false;c.pick(1);assert.equal(c.choices()[1].length,0);assert.notEqual(c.CustomerOptions.validate(groups,c.choices()),'');
groups[0].options[1].available=true;groups[0].name='麺量（全部2倍盛り）';c.pick(1);assert.equal(c.choices()[1].join(','),'2');
console.log('PASS: normal noodle default, explicit changes, selected-size retap, fresh reset, toppings unselected, non-noodle exclusion, unavailable normal stays invalid, double-size group.');
