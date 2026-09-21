/* Read-only end-of-day overview. Each source fails independently. */
(() => {
  const host = document.createElement('section');
  host.className = 'card';
  host.innerHTML = '<h2>閉店前のやり残し</h2><p>未会計・未提供は過去分も確認。勤務は昨日〜今日を確認します。</p><div id="closing-overview-grid" class="breakdown"></div><p id="closing-overview-time" role="status"></p><button type="button" class="btn" id="closing-overview-refresh">最新の状況を確認</button>';
  document.querySelector('.summary').before(host);
  const store = [1,2].includes(Number(window.MACHI_STORE_ID)) ? Number(window.MACHI_STORE_ID) : 1;
  const name = store === 2 ? '白木原店' : '長浜店';
  document.querySelector('.ey').textContent = '博多油そば151 · ' + name;
  const grid = document.getElementById('closing-overview-grid');
  const time = document.getElementById('closing-overview-time');
  const refresh = document.getElementById('closing-overview-refresh');
  const date = offset => new Date(Date.now() + 9*3600000 + offset*86400000).toISOString().slice(0,10);
  let running = false;
  async function read(api, params='') {
    const access = localStorage.machi_access_token || localStorage.mo_staff_token;
    if (!access) throw Error('ログインが必要');
    const response = await fetch('https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/'+api+'?store_id='+store+params, {
      headers: {Authorization:'Bearer '+access}, signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error('取得できません');
    return response.json();
  }
  function tile(label, value, detail, href, warning) {
    const a = document.createElement('a');
    a.className = 'metric'; a.style.cssText = 'color:inherit;text-decoration:none;min-height:110px;border:2px solid '+(warning?'#d58128':'#dbe5db');
    a.href = href+'?store_id='+store;
    for (const [tag,text] of [['span',label],['b',value],['span',detail+' →']]) {
      const el = document.createElement(tag); el.textContent = text; a.append(el);
    }
    return a;
  }
  async function update() {
    if (running) return;
    running = true; refresh.disabled = true; time.textContent = '確認しています…';
    grid.replaceChildren();
    const specs = [
      ['未会計','cashier-api','/cashier.html','', j => [j.orders.length+'件','会計を確認',j.orders.length>0]],
      ['未提供','kitchen-api','/kitchen.html','', j => [j.orders.length+'件','厨房を確認',j.orders.length>0]],
      ['退勤未打刻','workforce-api','/time-clock.html','&from='+date(-1)+'&to='+date(0), j => {
        const count = j.shifts.filter(s=>s.clock_in&&!s.clock_out&&s.status==='working').length;
        return [count+'件',j.planning?'昨日〜今日・店舗全体':'昨日〜今日・自分のみ（全員は店長確認）',count>0||!j.planning];
      }],
      ['日次締め','closing-api','/closing.html','', j => [j.closing?'締め済み':'未締め','この下で現金と引継ぎを確認',!j.closing]]
    ];
    const results = await Promise.allSettled(specs.map(s=>read(s[1],s[3])));
    let failed = false;
    results.forEach((r,i)=>{
      const s=specs[i];
      try {
        if(r.status==='rejected') throw r.reason;
        const [value,detail,warn]=s[4](r.value);
        grid.append(tile(s[0],value,detail,s[2],warn));
      } catch {
        failed=true; grid.append(tile(s[0],'未確認','接続・権限を確認して再取得',s[2],true));
      }
    });
    time.textContent = (failed?'一部未確認 · ':'最終確認 ') + new Date().toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})+'（日本時間）';
    running=false; refresh.disabled=false;
  }
  refresh.addEventListener('click',update);
  window.addEventListener('online',update);
  window.addEventListener('offline',()=>{grid.replaceChildren();time.textContent='通信が切れています。再接続後に最新の状況を確認してください。';});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
  setInterval(()=>{if(!document.hidden)update();},60000);
  update();
})();
