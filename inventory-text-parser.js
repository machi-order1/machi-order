(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MachiInventoryParser=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SHIRAKIBARU={
    key:'shirakibaru',store:'白木原店',
    categories:['冷蔵庫仕込み在庫','タレ系在庫','冷凍食材在庫','メイン食材在庫','買い出し系食材','飲み物','備品'],
    items:['青ネギ','白ネギ','半熟卵','高菜','高菜在庫','木耳','チャーシュー','チャーシュー丼','揚げ一味','ダシ','博多油','エビ油','ラー油','チャーシュー丼タレ','餃子のタレ','冷凍餃子','壱岐牛','枝豆','生卵','乾燥きくらげ','米','酢','にんにく','マヨネーズ','糸唐辛子','干し海老','すりごま','煮干し','カレー粉','ガーリックスライス','コーラ','カルピス','炭酸','黒霧','角','レモンサワーの素','ジンジャーエール','烏龍茶','オレンジジュース','赤いゴミ袋','割箸','テイクアウト用割箸','紙ナフキン','紙エプロン','麺'],
    aliases:{'きくらげ':'木耳','乾燥木耳':'乾燥きくらげ','黒霧島':'黒霧','テイクアウト割箸':'テイクアウト用割箸','レモンサワー素':'レモンサワーの素','ガーリックチップ':'ガーリックスライス'}
  };
  const NAGAHAMA={
    key:'nagahama',store:'長浜店',
    categories:['仕込み在庫','在庫','買い出し、補充等依頼'],
    items:['半熟卵','青ねぎ','白ねぎ','高菜','キクラゲ','ごはん小分け','チャーシュー','丼用チャーシュー','壱岐牛','チャーシュー丼タレ','ぎょうざタレ','卵','にんにく','冷凍チャーシュー','冷凍丼用チャーシュー','だし','博多油','えび油','ラー油','米酢','桜えび','糸唐辛子','すりごま','アジシオ','かつおだしの素','米','マヨネーズ','カレー粉缶','揚げ一味','餃子','枝豆','麺'],
    aliases:{'青ネギ':'青ねぎ','白ネギ':'白ねぎ','きくらげ':'キクラゲ','木耳':'キクラゲ','チャーシュー丼':'丼用チャーシュー','冷凍チャーシュー丼':'冷凍丼用チャーシュー','餃子のタレ':'ぎょうざタレ','ぎょうざのタレ':'ぎょうざタレ','エビ油':'えび油','えび塩油':'えび油','カレー粉':'カレー粉缶'}
  };
  const MASTER_ITEMS=['青ネギ（カット済）','白ネギ（カット済）','半熟卵','高菜（カット・炒め済）','木耳（水戻し済）','チャーシュー（仕込み済）','チャーシュー丼（仕込み済）','揚げ一味（仕込み済）','ごはん小分け','ダシ','博多油','エビ油','ラー油','チャーシュー丼タレ','餃子のタレ','米酢','冷凍チャーシュー','冷凍チャーシュー丼','冷凍餃子','壱岐牛','枝豆','揚げ一味（冷凍）','生卵','青ネギ（未仕込み）','白ネギ（未仕込み）','高菜漬け（未仕込み）','乾燥きくらげ','米','酢','にんにく','マヨネーズ','麺','糸唐辛子','干し海老','桜えび','すりごま','煮干し','カレー粉','ガーリックスライス','アジシオ','かつおだしの素','コーラ','カルピス','炭酸','黒霧島','角','レモンサワーの素','ジンジャーエール','烏龍茶','オレンジジュース','赤いゴミ袋','割箸','テイクアウト用割箸','紙ナフキン','紙エプロン'];
  const MASTER_GROUPS={};
  [['冷蔵庫仕込み在庫',MASTER_ITEMS.slice(0,9)],['タレ系在庫',MASTER_ITEMS.slice(9,16)],['冷凍食材在庫',MASTER_ITEMS.slice(16,22)],['メイン食材在庫',MASTER_ITEMS.slice(22,32)],['買い出し系食材',MASTER_ITEMS.slice(32,41)],['飲み物',MASTER_ITEMS.slice(41,50)],['備品',MASTER_ITEMS.slice(50)]].forEach(([group,names])=>names.forEach(name=>MASTER_GROUPS[name]=group));
  const MASTER_ALIASES={'卵':'生卵','青ねぎ':'青ネギ（未仕込み）','青ネギ':'青ネギ（未仕込み）','白ねぎ':'白ネギ（未仕込み）','白ネギ':'白ネギ（未仕込み）','高菜':'高菜（カット・炒め済）','高菜在庫':'高菜漬け（未仕込み）','木耳':'木耳（水戻し済）','キクラゲ':'木耳（水戻し済）','きくらげ':'木耳（水戻し済）','乾燥木耳':'乾燥きくらげ','チャーシュー':'チャーシュー（仕込み済）','チャーシュー丼':'チャーシュー丼（仕込み済）','丼用チャーシュー':'チャーシュー丼（仕込み済）','冷凍丼用チャーシュー':'冷凍チャーシュー丼','餃子のタレ':'餃子のタレ','ぎょうざタレ':'餃子のタレ','ぎょうざのタレ':'餃子のタレ','黒霧':'黒霧島','テイクアウト割箸':'テイクアウト用割箸','レモンサワー素':'レモンサワーの素','ガーリックチップ':'ガーリックスライス','エビ油':'エビ油','えび油':'エビ油','えび塩油':'エビ油','カレー粉缶':'カレー粉'};
  for(const template of [SHIRAKIBARU,NAGAHAMA]){template.items=MASTER_ITEMS;template.aliases={...template.aliases,...MASTER_ALIASES}}
  const TEMPLATES={shirakibaru:SHIRAKIBARU,nagahama:NAGAHAMA};
  const TEMPLATE={store:'白木原店・長浜店',categories:[...new Set([...SHIRAKIBARU.categories,...NAGAHAMA.categories])],items:[...new Set([...SHIRAKIBARU.items,...NAGAHAMA.items])],aliases:{...SHIRAKIBARU.aliases,...NAGAHAMA.aliases}};
  const normalize=value=>String(value??'').normalize('NFKC').replace(/[：﹕]/g,':').replace(/[　\t]+/g,' ').trim();
  const templateFor=value=>TEMPLATES[value]||Object.values(TEMPLATES).find(item=>item.store===value)||SHIRAKIBARU;
  const canonical=(name,template=SHIRAKIBARU)=>template.aliases[normalize(name)]||normalize(name);
  function parseValue(raw){
    const value=normalize(raw);
    if(!value)return{quantity:null,unit:'',status:'',detail:''};
    if(/[+×xX]/.test(value)||/^[大小中]/.test(value)||/^\d+段目$/.test(value))return{quantity:null,unit:'',status:value,detail:''};
    const match=value.match(/^(-?\d+(?:\.\d+)?)\s*([^\d\s(]+)?\s*(?:\((.*)\))?$/);
    if(!match)return{quantity:null,unit:'',status:value,detail:''};
    return{quantity:Number(match[1]),unit:match[2]||'',status:'',detail:normalize(match[3]||'')};
  }
  function parseHeader(line,storeHint){
    const value=normalize(line),date=value.match(/(\d{1,2})\/(\d{1,2})/);
    if(!date)return null;
    const store=/白木原/.test(value)?'白木原店':/長浜/.test(value)?'長浜店':storeHint||null;
    return{month:Number(date[1]),day:Number(date[2]),store,session:/ひる|昼/.test(value)?'midday':/よる|夜/.test(value)?'night':null};
  }
  function parseReport(text,options={}){
    const template=templateFor(options.template||options.store),storeHint=options.store||template.store;
    let category='',header=null,memoMode=false;const rows=[],notes=[],unknown=[];
    const itemPattern=[...template.items].sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
    const noColon=new RegExp(`^(${itemPattern})\\s*(-?\\d+(?:\\.\\d+)?(?:.*)?)$`);
    for(const original of String(text??'').split(/\r?\n/)){
      const line=normalize(original);if(!line)continue;
      const foundHeader=parseHeader(line,storeHint);if(foundHeader){header=foundHeader;continue}
      const section=line.match(/^[【\[](.+?)[】\]]$/);if(section){category=normalize(section[1]);memoMode=/残り僅か|わずか|要購入|依頼/.test(category);continue}
      if(/^※/.test(line)||/残り僅かな物|買い出し|補充.*依頼/.test(line)){memoMode=true;notes.push({type:'instruction',text:line});continue}
      if(/予約|取り置き/.test(line)){notes.push({type:'memo',text:line});continue}
      let name='',raw='';const colon=line.indexOf(':');
      if(colon>=0){name=canonical(line.slice(0,colon),template);raw=line.slice(colon+1)}
      else{const match=line.match(noColon);if(match){name=canonical(match[1],template);raw=match[2]}else if(template.items.includes(canonical(line,template))){name=canonical(line,template);raw='';memoMode=true}else{unknown.push({line:original,category});continue}}
      if(/仕込み在庫|冷蔵庫仕込み在庫/.test(category)){
        if(name==='青ネギ（未仕込み）')name='青ネギ（カット済）';if(name==='白ネギ（未仕込み）')name='白ネギ（カット済）';
      }
      if(!template.items.includes(name)){unknown.push({line:original,category,name});continue}
      const parsed=parseValue(raw);rows.push({name,category:category||'未分類',quantity:parsed.quantity,unit:parsed.unit,status:parsed.status,detail:parsed.detail,attention:memoMode||(!raw),raw:original});
    }
    return{template:template.key,header,rows,notes,unknown,summary:{recognized:rows.length,unknown:unknown.length,numeric:rows.filter(row=>row.quantity!==null).length,status:rows.filter(row=>row.quantity===null).length,attention:rows.filter(row=>row.attention).length}};
  }
  return{TEMPLATE,TEMPLATES,MASTER_ITEMS,MASTER_GROUPS,normalize,canonical,parseValue,parseHeader,parseReport};
});
