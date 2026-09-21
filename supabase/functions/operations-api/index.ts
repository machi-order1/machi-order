import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const managerRoles = new Set(['owner', 'admin', 'manager'])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
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
    if (!membership || !managerRoles.has(membership.role)) return json({ error: '操作履歴は店長のみ確認できます' }, 403)

    const { data: logs, error } = await sb.from('audit_logs')
      .select('id,user_id,action,entity_type,entity_id,details,created_at')
      .eq('store_id', storeId)
      .in('action', ['sale_status_changed', 'happy_hour_changed', 'ordering_changed', 'opening_check_completed', 'payment_completed', 'payment_reverted'])
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
