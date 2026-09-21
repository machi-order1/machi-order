const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
export async function managerRequests(sb: any, b: any, userId: string) {
  const { data: members, error: me } = await sb
    .from("store_memberships")
    .select("store_id")
    .eq("user_id", userId)
    .eq("active", true)
    .in("role", ["manager", "owner", "admin"]);
  if (me) throw me;
  const ids = (members || []).map((m: any) => m.store_id);
  if (!ids.length) return reply({ error: "店長権限が必要です" }, 403);
  if (b.action === "request_review") {
    if (
      !Number.isSafeInteger(b.request_id) ||
      !Number.isSafeInteger(b.revision) ||
      typeof b.approve !== "boolean"
    )
      return reply({ error: "操作内容が正しくありません" }, 400);
    const { data, error } = await sb.rpc("review_roster_shift_request", {
      p_request_id: b.request_id,
      p_revision: b.revision,
      p_approve: b.approve,
      p_actor: userId,
    });
    if (error) return reply({ error: error.message }, 409);
    return reply({ ok: true, shift_id: data });
  }
  const month = String(b.month || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return reply({ error: "対象月を選んでください" }, 400);
  const from = month + "-01",
    next = new Date(from + "T00:00:00Z");
  next.setUTCMonth(next.getUTCMonth() + 1);
  const { data, error } = await sb
    .from("roster_shift_requests")
    .select(
      "id,staff_id,store_id,work_date,preference,start_time,end_time,note,status,revision,shift_id,reviewed_at,staff_roster(display_name),stores(name)",
    )
    .in("store_id", ids)
    .gte("work_date", from)
    .lt("work_date", next.toISOString().slice(0, 10))
    .order("work_date");
  if (error) throw error;
  return reply({ requests: data || [] });
}
export async function staffRequests(
  sb: any,
  b: any,
  staffId: number,
  storeId: number,
  today: string,
) {
  if (b.action === "request_save") {
    const date = String(b.work_date || ""),
      available = b.preference === "available",
      unavailable = b.preference === "unavailable",
      start = available ? String(b.start_time || "") : null,
      end = available ? String(b.end_time || "") : null;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date ||
      (!available && !unavailable) ||
      (available &&
        (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start!) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(end!) ||
          start! >= end!))
    )
      return reply({ error: "希望日・時間を確認してください" }, 400);
    const { data, error } = await sb.rpc("save_roster_shift_request", {
      p_staff_id: staffId,
      p_store_id: storeId,
      p_date: date,
      p_preference: b.preference,
      p_start: start,
      p_end: end,
      p_note: String(b.note || "").slice(0, 300),
    });
    if (error) return reply({ error: error.message }, 409);
    return reply({ ok: true, request_id: data });
  }
  const { data: requests, error } = await sb
    .from("roster_shift_requests")
    .select(
      "id,work_date,preference,start_time,end_time,note,status,reviewed_at",
    )
    .eq("staff_id", staffId)
    .eq("store_id", storeId)
    .gte("work_date", today)
    .order("work_date")
    .limit(100);
  if (error) throw error;
  const { data: shifts, error: se } = await sb
    .from("work_shifts")
    .select("id,shift_date,scheduled_start,scheduled_end,status,stores(name)")
    .eq("roster_staff_id", staffId)
    .gte("shift_date", today)
    .in("status", ["scheduled", "working"])
    .order("shift_date")
    .limit(100);
  if (se) throw se;
  return reply({ requests: requests || [], shifts: shifts || [] });
}
