(() => {
  const $ = id => document.getElementById(id), storeId = String(window.MACHI_STORE_ID || new URLSearchParams(location.search).get('store_id') || 1)
  const token = () => localStorage.machi_access_token || localStorage.mo_staff_token || localStorage.access_token || localStorage.sb_access_token || ''
  const endpoint = mode => 'https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/receipt-api?' + new URLSearchParams({ store_id: storeId, mode })
  let selected = null, worker = null, busy = false, previewUrl = null
  const msg = (s, kind = '') => { $('message').textContent = s; $('message').className = s ? (kind || 'good') : '' }
  async function api(mode, method = 'GET', body, extras = {}) {
    const url = new URL(endpoint(mode)); for (const [k,v] of Object.entries(extras)) url.searchParams.set(k, v)
    const headers = { Authorization: `Bearer ${token()}` }
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
    const response = await fetch(url, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    const data = await response.json(); if (!response.ok) { const error = Error(data.error || '処理に失敗しました'); error.kind = data.kind; throw error } return data
  }
  const el = (tag, text, className = '') => { const e = document.createElement(tag); e.textContent = text; e.className = className; return e }
  const dateText = iso => new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(iso))
  $('month').value = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).format(new Date())
  $('photo').addEventListener('change', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); const file = $('photo').files[0]; $('preview').classList.toggle('hidden', !file); if (file) { previewUrl = URL.createObjectURL(file); $('preview').src = previewUrl } })
  async function compress(file) {
    if (file.size > 15*1024*1024) throw Error('写真が大きすぎます。15MB以下の写真を選んでください')
    if (!file.type.startsWith('image/')) throw Error('画像を選んでください')
    const bitmap = await createImageBitmap(file), scale = Math.min(1, 1800 / Math.max(bitmap.width,bitmap.height))
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width*scale); canvas.height = Math.round(bitmap.height*scale)
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close()
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.84)); if (!blob || blob.size > 5242880) throw Error('写真を5MB以下にしてください')
    return blob
  }
  async function ocr(blob) {
    if (!window.Tesseract) {
      await new Promise((resolve,reject) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.onload=resolve; s.onerror=reject; document.head.append(s) })
    }
    if (!worker) worker = await Tesseract.createWorker('jpn')
    const result = await worker.recognize(blob); return result.data.text || ''
  }
  async function submit(skip) {
    if (busy) return; const file = $('photo').files[0]; if (!file) return msg('写真を選んでください','error')
    busy=true; $('submit').disabled=$('skip').disabled=true
    try {
      $('upload-status').textContent='写真を準備中…'; const blob = await compress(file)
      let raw=''
      if (!skip) { try { $('upload-status').textContent='端末で文字を読み取り中…'; raw = await ocr(blob) } catch { $('upload-status').textContent='文字を読み取れなかったため、写真を提出します。' } }
      const form = new FormData(); form.append('image',blob,'receipt.jpg'); form.append('ocr_text',raw)
      $('upload-status').textContent='送信中…'; const data = await api('scan','POST',form)
      $('photo').value=''; $('preview').classList.add('hidden'); if (previewUrl) URL.revokeObjectURL(previewUrl)
      msg(data.duplicate_candidates?.length ? `写真を登録しました。同じ日付・金額の候補が ${data.duplicate_candidates.length} 件あります。店長が早めに確認してください。` : '写真を登録しました。店長の確認待ちです。',data.duplicate_candidates?.length ? 'alert':'good')
      $('upload-status').textContent=''; await load()
    } catch(e) { msg(e.message,'error'); $('upload-status').textContent='' }
    finally { busy=false; $('submit').disabled=$('skip').disabled=false }
  }
  $('submit').onclick=()=>submit(false); $('skip').onclick=()=>submit(true)
  async function load() {
    try {
      const data=await api('list'); $('pending').textContent=data.pending_count+(data.limited ? '+' : ''); $('overdue').textContent=data.overdue_count+(data.limited ? '+' : ''); $('duplicates').textContent=data.duplicate_count+(data.limited ? '+' : '')
      $('review').classList.toggle('hidden', !data.manager); $('month-card').classList.toggle('hidden', !data.manager)
      if (data.manager && !selected) $('review').classList.add('hidden')
      $('items').replaceChildren()
      if (!data.items.length) $('items').append(el('p','登録済みの写真はありません。','muted'))
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
      for (const row of data.items) {
        const pending=['needs_review','pending','failed'].includes(row.extraction_status), late=pending && new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.created_at))<today
        const label=`${late?'翌日以降の未確認 · ':''}${dateText(row.created_at)} · ${row.vendor_name || '取引先未読取'} · ${row.total_amount ? '¥'+Number(row.total_amount).toLocaleString():'金額未読取'} · ${row.extracted_data?.duplicate_candidates?.length?'重複候補 · ':''}${pending?'確認待ち':row.confirmed?'経費確定':'処理済み'}`
        const button=el('button',label,'item'+(late?' overdue':'')); button.onclick=()=>review(row,data.manager); $('items').append(button)
      }
      if (data.manager) await loadMonth()
    } catch(e) { msg(e.message,'error') }
  }
  async function review(row,manager) {
    selected=row; $('review').classList.toggle('hidden',!manager)
    try { const image=await api('image','GET',null,{ id:String(row.id) }); $('original').src=image.url; if(!manager) { window.open(image.url,'_blank','noopener'); return } }
    catch(e) { msg(e.message,'error'); return }
    const p=row.extracted_data?.proposal || {}, f=$('review-form').elements
    f.date.value=p.date || row.purchased_at?.slice(0,10) || ''; f.amount.value=p.amount || row.total_amount || ''; f.vendor.value=p.vendor || row.vendor_name || ''; f.name.value=p.name || ''; f.category.value=p.category || ''; f.tax_category.value=''; f.allow_possible_duplicate.checked=false
    $('duplicate-check').classList.toggle('hidden',!(row.extracted_data?.duplicate_candidates?.length))
    const notes=[...(p.flags||[])]; if(row.extracted_data?.duplicate_candidates?.length) notes.unshift(`同日・同額の候補が ${row.extracted_data.duplicate_candidates.length} 件あります`)
    $('review-warning').textContent=notes.join(' ／ ') || '写真の原本を確認してから確定してください'; $('review-warning').classList.remove('hidden')
    $('ocr').textContent=row.extracted_data?.ocr_text || '文字を読み取っていません。原本を確認してください。'
    $('review').scrollIntoView({behavior:'smooth'})
  }
  $('review-form').onsubmit=async event=>{event.preventDefault(); if(!selected)return; const f=$('review-form').elements
    if(selected.extracted_data?.inventory_warning) return msg('仕入れの可能性がある写真です。原価・在庫を確認して「経費以外として処理」してください。','error')
    if(selected.extracted_data?.duplicate_candidates?.length && !f.allow_possible_duplicate.checked) return msg('重複候補を確認し、別の支出の場合だけチェックしてください。','error')
    const button=$('review-form').querySelector('button'); button.disabled=true
    try { await api('confirm','POST',{id:selected.id,date:f.date.value,amount:Number(f.amount.value),vendor:f.vendor.value,name:f.name.value,category:f.category.value,tax_category:f.tax_category.value,allow_possible_duplicate:f.allow_possible_duplicate.checked}); msg('経費を確定し、月次集計へ反映しました。'); selected=null; $('review').classList.add('hidden'); await load() }
    catch(e) { if(e.kind==='possible_duplicate') $('duplicate-check').classList.remove('hidden'); msg(e.message,'error') } finally {button.disabled=false}
  }
  $('resolve').onclick=async()=>{if(!selected)return; const note=$('reason-note').value.trim(); if(note.length<3) return msg('処理理由を3文字以上で記入してください','error'); $('resolve').disabled=true
    try {await api('resolve','POST',{id:selected.id,reason:$('reason').value,note}); msg('理由を残して処理しました。'); selected=null; $('review').classList.add('hidden'); await load()} catch(e){msg(e.message,'error')}finally{$('resolve').disabled=false}
  }
  async function loadMonth(){const d=await api('month','GET',null,{month:$('month').value}); $('month-summary').textContent=`登録経費 ¥${Number(d.expense_total).toLocaleString()} ／ 写真確定 ${d.confirmed}件 ／ 未確認 ${d.pending}件 ／ 税区分未設定 ${d.unknown_tax}件${d.closing?' ／ 締め済み':''}`; $('close').disabled=!!d.closing || !!d.pending || !!d.unknown_tax}
  $('month').onchange=()=>loadMonth().catch(e=>msg(e.message,'error'))
  $('close').onclick=async()=>{ $('close').disabled=true; try{await api('close','POST',{month:$('month').value});msg($('month').value+'の経費を締めました。');await loadMonth()}catch(e){msg(e.message,'error');await loadMonth()}}
  load()
})()
