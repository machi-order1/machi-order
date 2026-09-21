import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type,apikey",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: H });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: H });
  try {
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return out({ error: "ログインが必要です" }, 401);
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: members } = await sb
      .from("store_memberships")
      .select("store_id,role")
      .eq("user_id", user.id)
      .eq("active", true);
    const permitted = (members || []).filter((x: any) =>
      ["manager", "owner", "admin"].includes(x.role),
    );
    if (!permitted.length) return out({ error: "店長権限が必要です" }, 403);
    const { data: baseStore } = await sb
      .from("stores")
      .select("brand_id")
      .eq("id", permitted[0].store_id)
      .single();
    const { data: brand } = await sb
      .from("brands")
      .select("company_id")
      .eq("id", baseStore!.brand_id)
      .single();
    const companyId = brand!.company_id;
    const { data: companyBrands } = await sb
      .from("brands")
      .select("id")
      .eq("company_id", companyId);
    const { data: stores } = await sb
      .from("stores")
      .select("id,name,brand_id")
      .in(
        "brand_id",
        (companyBrands || []).map((x: any) => x.id),
      );
    const storeIds = (stores || []).map((x: any) => x.id);
    if (!storeIds.length) return out({ error: "店舗情報がありません" }, 403);

    if (req.method === "GET") {
      const { data: staff, error } = await sb
        .from("staff_roster")
        .select("*,staff_store_assignments(id,store_id,role,active)")
        .eq("company_id", companyId)
        .order("active", { ascending: false })
        .order("display_name");
      if (error) throw error;
      const ids = (staff || []).map((x: any) => x.id);
      const { data: pins } = ids.length
        ? await sb
            .from("staff_kiosk_credentials")
            .select("staff_id")
            .in("staff_id", ids)
        : { data: [] };
      const ready = new Set((pins || []).map((x: any) => x.staff_id));
      return out({
        stores,
        staff: (staff || []).map((x: any) => ({
          ...x,
          kiosk_pin_set: ready.has(x.id),
        })),
      });
    }
    if (req.method !== "POST") return out({ error: "未対応の操作です" }, 405);
    const b = await req.json(),
      action = String(b.action || ""),
      id = Number(b.staff_id || 0);
    const name = String(b.display_name || "").trim(),
      type =
        b.employment_type === "fixed_salary" ? "fixed_salary" : "part_time";
    const wage = type === "part_time" ? Number(b.hourly_wage ?? 0) : 0,
      salary = type === "fixed_salary" ? Number(b.monthly_salary ?? 0) : 0;
    const assignments = Array.isArray(b.assignments) ? b.assignments : [],
      pin = String(b.kiosk_pin || "").trim();

    if (["create", "update"].includes(action)) {
      if (!name || name.length > 80 || wage < 0 || salary < 0)
        return out({ error: "氏名・給与を確認してください" }, 400);
      if (pin && !/^[0-9]{4,8}$/.test(pin))
        return out(
          { error: "打刻用暗証番号は4〜8桁の数字にしてください" },
          400,
        );
      if (!assignments.length)
        return out({ error: "勤務店舗を1つ以上選んでください" }, 400);
      if (assignments.some((x: any) => !storeIds.includes(Number(x.store_id))))
        return out({ error: "編集できない店舗が含まれています" }, 403);
      const row = {
        company_id: companyId,
        display_name: name,
        employment_type: type,
        hourly_wage: wage,
        monthly_salary: salary,
        nationality: b.nationality ? String(b.nationality).slice(0, 80) : null,
        note: b.note ? String(b.note).slice(0, 500) : null,
        active: true,
        left_on: null,
        updated_at: new Date().toISOString(),
      };
      let saved: any, error: any;
      if (action === "create")
        ({ data: saved, error } = await sb
          .from("staff_roster")
          .insert(row)
          .select()
          .single());
      else {
        if (!id) return out({ error: "スタッフIDが必要です" }, 400);
        ({ data: saved, error } = await sb
          .from("staff_roster")
          .update(row)
          .eq("id", id)
          .eq("company_id", companyId)
          .select()
          .single());
      }
      if (error)
        return out(
          {
            error:
              error.code === "23505"
                ? "同じ名前のスタッフが登録済みです"
                : "保存できませんでした",
          },
          409,
        );
      await sb
        .from("staff_store_assignments")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("staff_id", saved.id);
      const rows = assignments.map((x: any) => ({
        staff_id: saved.id,
        store_id: Number(x.store_id),
        role: ["manager", "owner"].includes(x.role) ? x.role : "staff",
        active: true,
        updated_at: new Date().toISOString(),
      }));
      const { error: ae } = await sb
        .from("staff_store_assignments")
        .upsert(rows, { onConflict: "staff_id,store_id" });
      if (ae) throw ae;
      if (pin) {
        const { error: pe } = await sb.rpc("set_staff_kiosk_pin", {
          p_staff_id: saved.id,
          p_pin: pin,
          p_updated_by: user.id,
        });
        if (pe) throw pe;
      }
      await sb
        .from("audit_logs")
        .insert({
          company_id: companyId,
          user_id: user.id,
          action: "staff_" + action,
          entity_type: "staff_roster",
          entity_id: String(saved.id),
          details: {
            display_name: name,
            assignments: rows,
            kiosk_pin_changed: !!pin,
          },
        });
      return out({ ok: true, staff: saved });
    }
    if (["deactivate", "reactivate"].includes(action)) {
      if (!id) return out({ error: "スタッフIDが必要です" }, 400);
      const active = action === "reactivate";
      const { data, error } = await sb
        .from("staff_roster")
        .update({
          active,
          left_on: active ? null : new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("company_id", companyId)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return out({ error: "スタッフが見つかりません" }, 404);
      await sb
        .from("staff_store_assignments")
        .update({ active, updated_at: new Date().toISOString() })
        .eq("staff_id", id);
      await sb
        .from("audit_logs")
        .insert({
          company_id: companyId,
          user_id: user.id,
          action: "staff_" + action,
          entity_type: "staff_roster",
          entity_id: String(id),
          details: { display_name: data.display_name },
        });
      return out({ ok: true });
    }
    return out({ error: "未対応の操作です" }, 400);
  } catch (e) {
    console.error(e);
    return out({ error: "処理できませんでした" }, 400);
  }
});
