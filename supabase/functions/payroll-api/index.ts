import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type,apikey",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const O = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: H });
const mins = (a: string | null, b: string | null, br = 0) =>
  a && b
    ? Math.max(
        0,
        Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000) -
          Number(br || 0),
      )
    : 0;
const sched = (a: string | null, b: string | null, br = 0) => {
  if (!a || !b) return 0;
  const p = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  return Math.max(0, p(b) - p(a) - Number(br || 0));
};
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: H });
  try {
    const authorization = req.headers.get("Authorization") || "",
      uc = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authorization } } },
      ),
      {
        data: { user },
      } = await uc.auth.getUser();
    if (!user) return O({ error: "ログインが必要です" }, 401);
    const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      ),
      { data: membership } = await sb
        .from("store_memberships")
        .select("store_id,role")
        .eq("user_id", user.id)
        .eq("active", true)
        .in("role", ["manager", "owner", "admin"])
        .limit(1)
        .maybeSingle();
    if (!membership) return O({ error: "店長権限が必要です" }, 403);
    const { data: base } = await sb
        .from("stores")
        .select("brand_id")
        .eq("id", membership.store_id)
        .single(),
      { data: brand } = await sb
        .from("brands")
        .select("company_id")
        .eq("id", base!.brand_id)
        .single(),
      companyId = brand!.company_id,
      { data: brands } = await sb
        .from("brands")
        .select("id")
        .eq("company_id", companyId),
      { data: stores } = await sb
        .from("stores")
        .select("id,name")
        .in(
          "brand_id",
          (brands || []).map((x: any) => x.id),
        ),
      storeIds = (stores || []).map((x: any) => x.id);
    if (req.method === "GET") {
      const u = new URL(req.url),
        month =
          u.searchParams.get("month") || new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month))
        return O({ error: "対象月が正しくありません" }, 400);
      const from = month + "-01",
        next = new Date(from + "T00:00:00Z");
      next.setUTCMonth(next.getUTCMonth() + 1);
      const to = next.toISOString().slice(0, 10),
        filterStore = Number(u.searchParams.get("store_id") || 0);
      if (filterStore && !storeIds.includes(filterStore))
        return O({ error: "店舗権限がありません" }, 403);
      const { data: staff, error: se } = await sb
        .from("staff_roster")
        .select(
          "id,display_name,employment_type,hourly_wage,monthly_salary,auth_user_id,active,staff_store_assignments(store_id,active)",
        )
        .eq("company_id", companyId);
      if (se) throw se;
      const { data: shifts, error } = await sb
        .from("work_shifts")
        .select(
          "id,store_id,roster_staff_id,user_id,shift_date,scheduled_start,scheduled_end,clock_in,clock_out,break_minutes,hourly_wage_snapshot,labor_cost,status,note,updated_at",
        )
        .in("store_id", storeIds)
        .gte("shift_date", from)
        .lt("shift_date", to)
        .neq("status", "cancelled")
        .order("shift_date");
      if (error) throw error;
      const byAuth = new Map(
          (staff || [])
            .filter((x: any) => x.auth_user_id)
            .map((x: any) => [x.auth_user_id, x.id]),
        ),
        all = (shifts || [])
          .map((x: any) => ({
            ...x,
            staff_id: x.roster_staff_id || byAuth.get(x.user_id) || null,
          }))
          .filter((x: any) => x.staff_id),
        rows = (staff || []).map((p: any) => {
          const ss = all.filter((x: any) => x.staff_id === p.id),
            actualMinutes = ss.reduce(
              (n: number, x: any) =>
                n + mins(x.clock_in, x.clock_out, x.break_minutes),
              0,
            ),
            scheduledMinutes = ss.reduce(
              (n: number, x: any) =>
                n + sched(x.scheduled_start, x.scheduled_end, x.break_minutes),
              0,
            ),
            actualPay =
              p.employment_type === "fixed_salary"
                ? Number(p.monthly_salary)
                : ss.reduce(
                    (n: number, x: any) =>
                      n +
                      (x.clock_in && x.clock_out
                        ? Math.round(
                            (mins(x.clock_in, x.clock_out, x.break_minutes) /
                              60) *
                              Number(x.hourly_wage_snapshot || p.hourly_wage),
                          )
                        : 0),
                    0,
                  ),
            scheduledPay =
              p.employment_type === "fixed_salary"
                ? Number(p.monthly_salary)
                : Math.round((scheduledMinutes / 60) * Number(p.hourly_wage));
          return {
            ...p,
            actual_minutes: actualMinutes,
            scheduled_minutes: scheduledMinutes,
            actual_pay: actualPay,
            scheduled_pay: scheduledPay,
            shifts: ss,
          };
        });
      const visible = filterStore
        ? rows
            .map((p: any) => {
              const fs = p.shifts.filter(
                  (x: any) => x.store_id === filterStore,
                ),
                am = fs.reduce(
                  (n: number, x: any) =>
                    n + mins(x.clock_in, x.clock_out, x.break_minutes),
                  0,
                ),
                sm = fs.reduce(
                  (n: number, x: any) =>
                    n +
                    sched(x.scheduled_start, x.scheduled_end, x.break_minutes),
                  0,
                ),
                assigned =
                  p.staff_store_assignments.filter((a: any) => a.active)
                    .length || 1,
                actualShare = p.actual_minutes
                  ? am / p.actual_minutes
                  : 1 / assigned,
                scheduledShare = p.scheduled_minutes
                  ? sm / p.scheduled_minutes
                  : 1 / assigned;
              return {
                ...p,
                shifts: fs,
                actual_minutes: am,
                scheduled_minutes: sm,
                actual_pay:
                  p.employment_type === "fixed_salary"
                    ? Math.round(p.monthly_salary * actualShare)
                    : fs.reduce(
                        (n: number, x: any) =>
                          n +
                          (x.clock_in && x.clock_out
                            ? Math.round(
                                (mins(
                                  x.clock_in,
                                  x.clock_out,
                                  x.break_minutes,
                                ) /
                                  60) *
                                  Number(
                                    x.hourly_wage_snapshot || p.hourly_wage,
                                  ),
                              )
                            : 0),
                        0,
                      ),
                scheduled_pay:
                  p.employment_type === "fixed_salary"
                    ? Math.round(p.monthly_salary * scheduledShare)
                    : Math.round((sm / 60) * p.hourly_wage),
              };
            })
            .filter((p: any) =>
              p.staff_store_assignments.some(
                (a: any) => a.store_id === filterStore && a.active,
              ),
            )
        : rows;
      return O({
        month,
        stores,
        store_id: filterStore || null,
        staff: visible,
        summary: {
          actual_pay: visible.reduce(
            (n: number, x: any) => n + x.actual_pay,
            0,
          ),
          scheduled_pay: visible.reduce(
            (n: number, x: any) => n + x.scheduled_pay,
            0,
          ),
          actual_minutes: visible.reduce(
            (n: number, x: any) => n + x.actual_minutes,
            0,
          ),
          scheduled_minutes: visible.reduce(
            (n: number, x: any) => n + x.scheduled_minutes,
            0,
          ),
        },
      });
    }
    if (req.method !== "POST") return O({ error: "未対応の操作です" }, 405);
    const b = await req.json();
    if (
      [
        "shift_create",
        "shift_update",
        "shift_cancel",
        "attendance_save",
      ].includes(b.action)
    ) {
      const { data, error } = await sb.rpc("manage_roster_shift", {
        p_actor: user.id,
        p_body: b,
      });
      if (error) return O({ error: error.message }, 409);
      return O({ ok: true, shift: data });
    }
    return O({ error: "未対応の操作です" }, 400);
  } catch (e) {
    console.error(e);
    return O({ error: "処理できませんでした" }, 400);
  }
});
