import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const managerRoles = new Set(['owner', 'admin', 'manager'])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const authorization = req.headers.get('Authorization') || ''
    const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return json({ error: 'ログインが必要です' }, 401)
    const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const parsed = new URL(req.url)
    const storeId = Number(parsed.searchParams.get('store_id') || 1)
    if (!Number.isInteger(storeId) || storeId < 1) return json({ error: '店舗が正しくありません' }, 400)
    const { data: membership } = await sb.from('store_memberships').select('role').eq('store_id', storeId).eq('user_id', user.id).eq('active', true).maybeSingle()
    if (!membership) return json({ error: '店舗の権限がありません' }, 403)

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      if (body.action === 'task_done') {
        const taskId = Number(body.task_id)
        if (!Number.isInteger(taskId) || taskId < 1) return json({ error: 'タスクが正しくありません' }, 400)
        const completedAt = new Date().toISOString()
        const { data: task, error } = await sb.from('store_tasks')
          .update({ status: 'completed', completed_at: completedAt, completed_by: user.id })
          .eq('id', taskId)
          .eq('store_id', storeId)
          .neq('status', 'completed')
          .select('id,title,status,completed_at')
          .maybeSingle()
        if (error) throw error
        if (!task) return json({ error: 'タスクが見つからないか、すでに完了しています' }, 409)
        await sb.from('audit_logs').insert({ store_id: storeId, user_id: user.id, action: 'store_task_completed', entity_type: 'store_task', entity_id: String(taskId), details: { title: task.title } })
        return json({ ok: true, task })
      }
      if (body.action !== 'handoff') return json({ error: '未対応の操作です' }, 400)
      const message = String(body.message || '').trim().slice(0, 500)
      if (!message) return json({ error: '引継ぎ内容を入力してください' }, 400)
      const priority = body.priority === 'high' ? 'high' : 'normal'
      const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
      const { data: handoff, error } = await sb.from('store_handoffs').insert({ store_id: storeId, business_date: businessDate, category: 'handoff', message, priority, created_by: user.id }).select().single()
      if (error) throw error
      await sb.from('audit_logs').insert({ store_id: storeId, user_id: user.id, action: 'handoff_created', entity_type: 'store_handoff', entity_id: String(handoff.id), details: { business_date: businessDate, priority } })
      return json({ ok: true, handoff })
    }
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
    if (parsed.searchParams.get('mode') === 'tasks') {
      const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
      const { data: tasks, error } = await sb.from('store_tasks')
        .select('id,title,category,due_at,priority,status,notes,completed_at')
        .eq('store_id', storeId)
        .eq('business_date', businessDate)
        .order('priority', { ascending: true })
        .order('due_at', { ascending: true, nullsFirst: false })
      if (error) throw error
      return json({ tasks: tasks || [], business_date: businessDate, role: membership.role })
    }
    if (parsed.searchParams.get('mode') === 'summary') {
      if (!managerRoles.has(membership.role)) return json({ error: '店長権限が必要です' }, 403)
      const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
      const [{ data: taskRows, error: taskError }, { data: handoffs, error: handoffError }, { data: hygiene, error: hygieneError }] = await Promise.all([
        sb.from('store_tasks').select('id,title,status,priority,due_at').eq('store_id', storeId).eq('business_date', businessDate),
        sb.from('store_handoffs').select('id,message,priority,created_at').eq('store_id', storeId).is('resolved_at', null).order('created_at', { ascending: false }).limit(50),
        sb.from('hygiene_checks').select('id,session,passed,checked_at').eq('store_id', storeId).eq('business_date', businessDate),
      ])
      if (taskError || handoffError || hygieneError) throw taskError || handoffError || hygieneError
      const tasks = (taskRows || []).filter((task: any) => !['done', 'completed'].includes(task.status))
      return json({ business_date: businessDate, tasks, handoffs: handoffs || [], hygiene: hygiene || [], role: membership.role })
    }
    if (!managerRoles.has(membership.role)) return json({ error: '操作履歴は店長のみ確認できます' }, 403)

    const { data: logs, error } = await sb.from('audit_logs')
      .select('id,user_id,action,entity_type,entity_id,details,created_at')
      .eq('store_id', storeId)
      .in('action', ['sale_status_changed', 'happy_hour_changed', 'ordering_changed', 'opening_check_completed', 'payment_completed', 'payment_reverted', 'daily_closing_completed', 'inventory_count_recorded', 'handoff_created', 'store_task_completed'])
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const userIds = [...new Set((logs || []).map((row: any) => row.user_id).filter(Boolean))]
    const { data: profiles } = userIds.length
      ? await sb.from('staff_profiles').select('user_id,display_name').in('user_id', userIds)
      : { data: [] as any[] }
    const names = new Map((profiles || []).map((profile: any) => [profile.user_id, profile.display_name]))
    return json({
      logs: (logs || []).map((row: any) => ({ ...row, staff_name: names.get(row.user_id) || 'スタッフ' })),
      role: membership.role,
    })
  } catch (error) {
    console.error(error)
    return json({ error: '操作履歴を取得できませんでした' }, 500)
  }
})
