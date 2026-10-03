import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseReceipt } from './parser.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } })
const errorMessage = (error: any) => String(error?.message || error || '')
const dateValid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
const mimeOf = (b: Uint8Array) => b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg' : b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 ? 'image/png' : String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' ? 'image/webp' : null
const managerRoles = ['owner', 'admin', 'manager']
const pendingStatuses = ['needs_review', 'pending', 'failed']
const select = 'id,store_id,created_by,created_at,purchased_at,vendor_name,total_amount,extraction_status,extracted_data,confirmed,confirmed_at,review_note'
const jpDate = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
  const query = new URL(request.url).searchParams, storeId = Number(query.get('store_id'))
  if (!Number.isSafeInteger(storeId) || storeId <= 0) return reply({ error: '店舗を確認してください' }, 400)
  try {
    const url = Deno.env.get('SUPABASE_URL')!, authorization = request.headers.get('Authorization') || ''
    const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: authError } = await auth.auth.getUser()
    if (authError || !user) return reply({ error: 'ログインが必要です' }, 401)
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: member, error: memberError } = await db.from('store_memberships').select('role').eq('user_id', user.id).eq('store_id', storeId).eq('active', true).maybeSingle()
    if (memberError) throw memberError
    if (!member || !['owner','admin','manager','staff','kitchen','viewer'].includes(member.role)) return reply({ error: '店舗の権限がありません' }, 403)
    const manager = managerRoles.includes(member.role), mode = query.get('mode') || 'list'
    if (request.method === 'POST' && mode === 'scan') {
      if (member.role === 'viewer') return reply({ error: '登録権限がありません' }, 403)
      const form = await request.formData(), image = form.get('image'), raw = String(form.get('ocr_text') || '').slice(0, 12000)
      if (!(image instanceof File) || image.size < 100 || image.size > 5242880) return reply({ error: '5MB以下の写真を選んでください' }, 400)
      const bytes = new Uint8Array(await image.arrayBuffer()), mime = mimeOf(bytes)
      if (!mime) return reply({ error: 'JPEG、PNG、WebPの写真を選んでください' }, 400)
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('')
      const { data: existing, error: hashError } = await db.from('receipt_imports').select('id,extraction_status').eq('store_id', storeId).eq('image_sha256', sha).maybeSingle()
      if (hashError) throw hashError
      if (existing) return reply({ error: '同じ写真が登録済みです', duplicate_id: existing.id, kind: 'exact_duplicate' }, 409)
      const proposal = parseReceipt(raw), candidates: any[] = []
      if (proposal.date && proposal.amount) {
        const { data: expenses, error: expenseError } = await db.from('store_expenses').select('id,vendor_name,amount,expense_date').eq('store_id', storeId).eq('expense_date', proposal.date).eq('amount', proposal.amount).is('voided_at', null).limit(20)
        if (expenseError) throw expenseError
        const { data: receipts, error: receiptError } = await db.from('receipt_imports').select('id,vendor_name,total_amount,purchased_at,extraction_status,extracted_data').eq('store_id', storeId).eq('total_amount', proposal.amount).limit(50)
        if (receiptError) throw receiptError
        const similarVendor = (vendor: string | null) => !proposal.vendor || !vendor || vendor.normalize('NFKC').replace(/\s/g, '') === proposal.vendor.normalize('NFKC').replace(/\s/g, '')
        for (const row of expenses || []) if (similarVendor(row.vendor_name)) candidates.push({ id: row.id, source: 'expense' })
        for (const row of receipts || []) if ((row.purchased_at && jpDate(row.purchased_at) === proposal.date || row.extracted_data?.proposal?.date === proposal.date) && similarVendor(row.vendor_name || row.extracted_data?.proposal?.vendor)) candidates.push({ id: row.id, source: 'receipt' })
      }
      const path = `${storeId}/${crypto.randomUUID()}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`
      const { error: uploadError } = await db.storage.from('expense-receipts').upload(path, bytes, { contentType: mime, upsert: false })
      if (uploadError) throw uploadError
      const { data: saved, error: saveError } = await db.from('receipt_imports').insert({ store_id: storeId, created_by: user.id, image_path: path, image_sha256: sha, mime_type: mime, extraction_status: 'needs_review', purchased_at: proposal.date ? `${proposal.date}T00:00:00+09:00` : null, vendor_name: proposal.vendor, total_amount: proposal.amount, extracted_data: { ocr_text: raw, proposal, duplicate_candidates: candidates, inventory_warning: proposal.flags.some(x => x.includes('仕入れ')) } }).select('id').single()
      if (saveError) { await db.storage.from('expense-receipts').remove([path]); if (saveError.code === '23505') return reply({ error: '同じ写真が登録済みです', kind: 'exact_duplicate' }, 409); throw saveError }
      return reply({ id: saved.id, proposal, duplicate_candidates: candidates })
    }
    if (request.method === 'GET' && mode === 'image') {
      const id = Number(query.get('id'))
      if (!Number.isSafeInteger(id)) return reply({ error: '写真を確認してください' }, 400)
      const { data: receipt, error } = await db.from('receipt_imports').select('image_path,created_by').eq('id', id).eq('store_id', storeId).single()
      if (error || !receipt || (!manager && receipt.created_by !== user.id)) return reply({ error: '写真を開けません' }, 403)
      const { data, error: signedError } = await db.storage.from('expense-receipts').createSignedUrl(receipt.image_path, 60)
      if (signedError) throw signedError
      return reply({ url: data.signedUrl })
    }
    if (request.method === 'GET' && mode === 'list') {
      let pendingQuery = db.from('receipt_imports').select(select).eq('store_id', storeId).in('extraction_status', pendingStatuses).order('created_at', { ascending: true }).limit(100)
      let recentQuery = db.from('receipt_imports').select(select).eq('store_id', storeId).order('created_at', { ascending: false }).limit(50)
      let countQuery = db.from('receipt_imports').select('id', { count: 'exact', head: true }).eq('store_id', storeId).in('extraction_status', pendingStatuses)
      const today = jpDate(new Date().toISOString())
      let overdueQuery = db.from('receipt_imports').select('id', { count: 'exact', head: true }).eq('store_id', storeId).in('extraction_status', pendingStatuses).lt('created_at', `${today}T00:00:00+09:00`)
      if (!manager) { pendingQuery = pendingQuery.eq('created_by', user.id); recentQuery = recentQuery.eq('created_by', user.id); countQuery = countQuery.eq('created_by', user.id); overdueQuery = overdueQuery.eq('created_by', user.id) }
      const [pendingRows, recentRows, pendingCount, overdueCount] = await Promise.all([pendingQuery, recentQuery, countQuery, overdueQuery])
      const failure = [pendingRows,recentRows,pendingCount,overdueCount].find(result => result.error)
      if (failure?.error) throw failure.error
      const byId = new Map<number, any>()
      for (const item of [...(pendingRows.data || []),...(recentRows.data || [])]) byId.set(item.id,item)
      const items = [...byId.values()].sort((a: any,b: any) => {
        const rank = (x: any) => pendingStatuses.includes(x.extraction_status) ? (jpDate(x.created_at) < today ? 0 : 1) : 2
        return rank(a)-rank(b) || b.created_at.localeCompare(a.created_at)
      })
      return reply({ role: member.role, manager, items, pending_count: pendingCount.count || 0, overdue_count: overdueCount.count || 0, duplicate_count: (pendingRows.data || []).filter((x: any) => x.extracted_data?.duplicate_candidates?.length).length, limited: (pendingRows.data || []).length === 100 || (recentRows.data || []).length === 50 })
    }
    if (!manager) return reply({ error: '店長権限が必要です' }, 403)
    if (request.method === 'GET' && mode === 'storage') {
      const { data, error } = await db.rpc('evidence_storage_usage', { p_store_id: storeId })
      if (error) throw error
      return reply({ ...data, reference_bytes: 1073741824, measured_at: new Date().toISOString() })
    }
    if (request.method === 'POST' && mode === 'confirm') {
      const body = await request.json(), id = Number(body.id), amount = Number(body.amount), date = String(body.date || ''), vendor = String(body.vendor || '').trim(), name = String(body.name || '').trim(), category = String(body.category || ''), tax = String(body.tax_category || '')
      if (!Number.isSafeInteger(id) || !dateValid(date) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000 || !vendor || vendor.length > 200 || !name || name.length > 200 || !['家賃','水道光熱費','消耗品費','広告宣伝費','支払手数料','通信費','修繕費','その他'].includes(category) || !['taxable_10','taxable_8','non_taxable','exempt','out_of_scope'].includes(tax)) return reply({ error: '日付・金額・取引先・費目・税区分を確認してください' }, 400)
      const { data, error } = await db.rpc('confirm_receipt_expense', { p_store_id: storeId, p_receipt_id: id, p_user_id: user.id, p_date: date, p_vendor: vendor, p_name: name, p_category: category, p_amount: amount, p_tax: tax, p_allow_possible_duplicate: body.allow_possible_duplicate === true })
      if (error) { if (errorMessage(error).includes('possible_duplicate')) return reply({ error: '同じ日付・金額・取引先の経費があります。原本を確認してください', kind: 'possible_duplicate' }, 409); if (errorMessage(error).includes('inventory_purchase')) return reply({ error: '仕入れの可能性があります。在庫・原価への反映を確認してください' }, 409); if (errorMessage(error).includes('expense_month_closed')) return reply({ error: 'この月は締め済みです' }, 409); throw error }
      return reply({ id: data, confirmed: true })
    }
    if (request.method === 'POST' && mode === 'resolve') {
      const body = await request.json(), id = Number(body.id), reason = String(body.reason || ''), note = String(body.note || '').trim()
      if (!Number.isSafeInteger(id) || !['inventory','personal','duplicate','other'].includes(reason) || note.length < 3 || note.length > 500) return reply({ error: '処理理由とメモを入力してください' }, 400)
      const { error } = await db.rpc('resolve_receipt_import', { p_store_id: storeId, p_receipt_id: id, p_user_id: user.id, p_reason: reason, p_note: note })
      if (error) { if (errorMessage(error).includes('receipt_already_resolved')) return reply({ error: 'この写真は既に処理済みです' }, 409); throw error }
      return reply({ resolved: true })
    }
    if (request.method === 'GET' && mode === 'month') {
      const month = String(query.get('month') || ''), start = `${month}-01`
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return reply({ error: '月を確認してください' }, 400)
      const [overview, closing] = await Promise.all([
        db.rpc('expense_month_overview', { p_store_id: storeId, p_month: start }).single(),
        db.from('expense_month_closings').select('id,closed_at,expense_total,expense_count,receipt_count').eq('store_id',storeId).eq('month',start).is('reopened_at',null).maybeSingle()
      ])
      if (overview.error || closing.error) throw overview.error || closing.error
      return reply({ month, ...overview.data, closing: closing.data })
    }
    if (request.method === 'POST' && mode === 'close') {
      const body = await request.json(), month = String(body.month || '')
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return reply({ error: '月を確認してください' }, 400)
      const { data, error } = await db.rpc('close_expense_month', { p_store_id: storeId, p_month: `${month}-01`, p_user_id: user.id })
      if (error) { const msg = errorMessage(error); if (['pending_receipts','unknown_tax_category','month_not_finished'].some(x => msg.includes(x))) return reply({ error: msg.includes('pending') ? '未確認の写真があります' : msg.includes('unknown') ? '税区分が未設定の経費があります' : '月末を過ぎてから締めてください' }, 409); throw error }
      return reply({ id: data, closed: true })
    }
    if (request.method === 'POST' && mode === 'reopen') {
      const body = await request.json(), month = String(body.month || ''), reason = String(body.reason || '').trim()
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || reason.length < 5 || reason.length > 500) return reply({ error: '対象月と理由を確認してください' }, 400)
      const { data, error } = await db.rpc('reopen_expense_month', { p_store_id: storeId, p_month: `${month}-01`, p_user_id: user.id, p_reason: reason })
      if (error) { if (errorMessage(error).includes('month_not_closed')) return reply({ error: 'この月は締められていません' }, 409); throw error }
      return reply({ id: data, reopened: true })
    }
    return reply({ error: '操作が見つかりません' }, 404)
  } catch (error) { console.error(error); return reply({ error: '処理に失敗しました。もう一度お試しください' }, 500) }
})
