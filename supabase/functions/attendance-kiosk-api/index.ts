import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { managerRequests, staffRequests } from "./requests.ts";

const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,content-type,apikey,x-kiosk-token",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: H });
const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const sha = async (value: string) =>
  hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
const token = () => {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};
const day = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: H });
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authorization = req.headers.get("Authorization") || "";
    let manager: any = null,
      companyId = 0,
      companyStoreIds: number[] = [];
    if (authorization) {
      const uc = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authorization } } },
      );
      const {
        data: { user },
      } = await uc.auth.getUser();
      if (user) {
        const { data: m } = await sb
          .from("store_memberships")
          .select("store_id,role")
          .eq("user_id", user.id)
          .eq("active", true)
          .in("role", ["manager", "owner", "admin"])
          .limit(1)
          .maybeSingle();
        if (m) {
          const { data: s } = await sb
            .from("stores")
            .select("brand_id")
            .eq("id", m.store_id)
            .single();
          const { data: b } = await sb
            .from("brands")
            .select("company_id")
            .eq("id", s!.brand_id)
            .single();
          const { data: brands } = await sb
            .from("brands")
            .select("id")
            .eq("company_id", b!.company_id);
          const { data: stores } = await sb
            .from("stores")
            .select("id,name")
            .in(
              "brand_id",
              (brands || []).map((x: any) => x.id),
            );
          manager = { user, stores: stores || [] };
          companyId = b!.company_id;
          companyStoreIds = (stores || []).map((x: any) => x.id);
        }
      }
    }
    const rawDevice = req.headers.get("x-kiosk-token") || "";
    let device: any = null;
    if (rawDevice) {
      const { data: d } = await sb
        .from("attendance_kiosk_devices")
        .select("id,store_id,device_name")
        .eq("token_hash", await sha(rawDevice))
        .eq("active", true)
        .maybeSingle();
      if (d) {
        device = d;
        await sb
          .from("attendance_kiosk_devices")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", d.id);
      }
    }

    if (req.method === "GET") {
      if (manager) {
        const { data: devices } = await sb
          .from("attendance_kiosk_devices")
          .select("id,store_id,device_name,active,last_seen_at,created_at")
          .in("store_id", companyStoreIds)
          .order("created_at");
        return out({ stores: manager.stores, devices: devices || [] });
      }
      if (!device) return out({ error: "この端末は未登録です" }, 401);
      const { data: assigned } = await sb
        .from("staff_store_assignments")
        .select("staff_id")
        .eq("store_id", device.store_id)
        .eq("active", true);
      const ids = (assigned || []).map((x: any) => x.staff_id);
      if (!ids.length)
        return out({
          store_id: device.store_id,
          device_name: device.device_name,
          staff: [],
        });
      const { data: staff } = await sb
        .from("staff_roster")
        .select("id,display_name")
        .in("id", ids)
        .eq("active", true)
        .order("display_name");
      const { data: credentials } = await sb
        .from("staff_kiosk_credentials")
        .select("staff_id")
        .in("staff_id", ids);
      const ready = new Set((credentials || []).map((x: any) => x.staff_id));
      return out({
        store_id: device.store_id,
        device_name: device.device_name,
        staff: (staff || []).filter((x: any) => ready.has(x.id)),
      });
    }
    if (req.method !== "POST") return out({ error: "未対応の操作です" }, 405);
    const b = await req.json(),
      action = String(b.action || "");
    if (["request_list", "request_review"].includes(action)) {
      if (!manager) return out({ error: "店長ログインが必要です" }, 401);
      return await managerRequests(sb, b, manager.user.id);
    }

    if (["device_register", "device_revoke", "pin_set"].includes(action)) {
      if (!manager) return out({ error: "店長ログインが必要です" }, 401);
      if (action === "device_register") {
        const storeId = Number(b.store_id || 0),
          name = String(b.device_name || "店舗打刻端末")
            .trim()
            .slice(0, 80);
        if (!companyStoreIds.includes(storeId) || !name)
          return out({ error: "店舗・端末名を確認してください" }, 400);
        const raw = token(),
          { data, error } = await sb
            .from("attendance_kiosk_devices")
            .insert({
              store_id: storeId,
              device_name: name,
              token_hash: await sha(raw),
              created_by: manager.user.id,
            })
            .select("id,store_id,device_name")
            .single();
        if (error) throw error;
        await sb.from("audit_logs").insert({
          company_id: companyId,
          store_id: storeId,
          user_id: manager.user.id,
          action: "attendance_kiosk_register",
          entity_type: "attendance_kiosk_device",
          entity_id: data.id,
          details: { device_name: name },
        });
        return out({ ok: true, device: data, kiosk_token: raw });
      }
      if (action === "device_revoke") {
        const id = String(b.device_id || ""),
          { data, error } = await sb
            .from("attendance_kiosk_devices")
            .update({ active: false, revoked_at: new Date().toISOString() })
            .eq("id", id)
            .in("store_id", companyStoreIds)
            .select("id,store_id")
            .maybeSingle();
        if (error) throw error;
        if (!data) return out({ error: "端末が見つかりません" }, 404);
        return out({ ok: true });
      }
      const staffId = Number(b.staff_id || 0),
        pin = String(b.pin || "");
      const { data: person } = await sb
        .from("staff_roster")
        .select("id,display_name")
        .eq("id", staffId)
        .eq("company_id", companyId)
        .eq("active", true)
        .maybeSingle();
      if (!person || !/^[0-9]{4,8}$/.test(pin))
        return out({ error: "スタッフ・暗証番号を確認してください" }, 400);
      const { error } = await sb.rpc("set_staff_kiosk_pin", {
        p_staff_id: staffId,
        p_pin: pin,
        p_updated_by: manager.user.id,
      });
      if (error) throw error;
      await sb.from("audit_logs").insert({
        company_id: companyId,
        user_id: manager.user.id,
        action: "staff_kiosk_pin_set",
        entity_type: "staff_roster",
        entity_id: String(staffId),
        details: { display_name: person.display_name },
      });
      return out({ ok: true });
    }

    if (!device) return out({ error: "この端末は未登録です" }, 401);
    const staffId = Number(b.staff_id || 0),
      pin = String(b.pin || "");
    const { data: valid, error: ve } = await sb.rpc("verify_staff_kiosk_pin", {
      p_store_id: device.store_id,
      p_staff_id: staffId,
      p_pin: pin,
    });
    if (ve) throw ve;
    if (!valid)
      return out(
        { error: "暗証番号が違うか、一時的にロックされています" },
        401,
      );
    const { data: person } = await sb
      .from("staff_roster")
      .select("id,display_name,hourly_wage,auth_user_id")
      .eq("id", staffId)
      .eq("active", true)
      .single();
    const storeId = device.store_id,
      today = day();
    if (["request_save", "my_requests"].includes(action))
      return await staffRequests(sb, b, staffId, storeId, today);
    const { data: working } = await sb
      .from("work_shifts")
      .select("*")
      .eq("store_id", storeId)
      .eq("roster_staff_id", staffId)
      .eq("status", "working")
      .is("clock_out", null)
      .maybeSingle();
    const current = working || null;
    if (action === "status") {
      let onBreak = false;
      if (current) {
        const { data: br } = await sb
          .from("work_breaks")
          .select("id")
          .eq("shift_id", current.id)
          .is("ended_at", null)
          .maybeSingle();
        onBreak = !!br;
      }
      const { data: shifts } = await sb
        .from("work_shifts")
        .select(
          "id,shift_date,scheduled_start,scheduled_end,clock_in,clock_out,break_minutes,status",
        )
        .eq("store_id", storeId)
        .eq("roster_staff_id", staffId)
        .eq("shift_date", today)
        .neq("status", "cancelled")
        .order("scheduled_start");
      return out({
        person: { id: person.id, display_name: person.display_name },
        current: { working: !!current, on_break: onBreak, shift: current },
        shifts: shifts || [],
      });
    }
    if (action === "clock_in") {
      if (current) return out({ error: "すでに出勤中です" }, 409);
      const now = new Date(),
        { data: scheduled } = await sb
          .from("work_shifts")
          .select("*")
          .eq("store_id", storeId)
          .eq("roster_staff_id", staffId)
          .eq("shift_date", today)
          .eq("status", "scheduled")
          .order("scheduled_start")
          .limit(1)
          .maybeSingle();
      if (scheduled) {
        const { data, error } = await sb
          .from("work_shifts")
          .update({
            clock_in: now.toISOString(),
            status: "working",
            hourly_wage_snapshot:
              scheduled.hourly_wage_snapshot || person.hourly_wage,
            updated_at: now.toISOString(),
          })
          .eq("id", scheduled.id)
          .eq("status", "scheduled")
          .select()
          .maybeSingle();
        if (error) throw error;
        if (!data) return out({ error: "別端末で出勤処理されました" }, 409);
        return out({ ok: true, shift: data });
      }
      const local = now
          .toLocaleTimeString("ja-JP", {
            timeZone: "Asia/Tokyo",
            hour12: false,
          })
          .slice(0, 5),
        { data, error } = await sb
          .from("work_shifts")
          .insert({
            store_id: storeId,
            roster_staff_id: staffId,
            user_id: person.auth_user_id,
            shift_date: today,
            scheduled_start: local,
            clock_in: now.toISOString(),
            status: "working",
            hourly_wage_snapshot: person.hourly_wage,
            note: "店舗端末から予定外出勤",
          })
          .select()
          .single();
      if (error) throw error;
      return out({ ok: true, shift: data });
    }
    if (action === "break_start") {
      if (!current) return out({ error: "先に出勤してください" }, 400);
      const { data: open } = await sb
        .from("work_breaks")
        .select("id")
        .eq("shift_id", current.id)
        .is("ended_at", null)
        .maybeSingle();
      if (open) return out({ error: "すでに休憩中です" }, 409);
      const { data, error } = await sb
        .from("work_breaks")
        .insert({
          shift_id: current.id,
          store_id: storeId,
          roster_staff_id: staffId,
          user_id: person.auth_user_id,
        })
        .select()
        .single();
      if (error) throw error;
      return out({ ok: true, break: data });
    }
    if (action === "break_end") {
      if (!current) return out({ error: "出勤中ではありません" }, 400);
      const { data: br } = await sb
        .from("work_breaks")
        .select("*")
        .eq("shift_id", current.id)
        .is("ended_at", null)
        .maybeSingle();
      if (!br) return out({ error: "休憩中ではありません" }, 400);
      const ended = new Date(),
        minutes = Math.max(
          0,
          Math.round(
            (ended.getTime() - new Date(br.started_at).getTime()) / 60000,
          ),
        ),
        { data, error } = await sb
          .from("work_breaks")
          .update({ ended_at: ended.toISOString(), minutes })
          .eq("id", br.id)
          .is("ended_at", null)
          .select()
          .maybeSingle();
      if (error) throw error;
      if (!data) return out({ error: "別端末で休憩終了されました" }, 409);
      const { data: all } = await sb
          .from("work_breaks")
          .select("minutes")
          .eq("shift_id", current.id)
          .not("ended_at", "is", null),
        total = (all || []).reduce(
          (n: number, x: any) => n + Number(x.minutes || 0),
          0,
        );
      await sb
        .from("work_shifts")
        .update({ break_minutes: total, updated_at: ended.toISOString() })
        .eq("id", current.id);
      return out({ ok: true, break_minutes: total });
    }
    if (action === "clock_out") {
      if (!current) return out({ error: "出勤中ではありません" }, 400);
      const { data: open } = await sb
        .from("work_breaks")
        .select("id")
        .eq("shift_id", current.id)
        .is("ended_at", null)
        .maybeSingle();
      if (open)
        return out({ error: "休憩終了を押してから退勤してください" }, 409);
      const ended = new Date(),
        minutes = Math.max(
          0,
          (ended.getTime() - new Date(current.clock_in).getTime()) / 60000 -
            Number(current.break_minutes || 0),
        ),
        labor = Math.round(
          (minutes / 60) *
            Number(current.hourly_wage_snapshot || person.hourly_wage),
        ),
        { data, error } = await sb
          .from("work_shifts")
          .update({
            clock_out: ended.toISOString(),
            labor_cost: labor,
            status: "completed",
            updated_at: ended.toISOString(),
          })
          .eq("id", current.id)
          .eq("status", "working")
          .is("clock_out", null)
          .select()
          .maybeSingle();
      if (error) throw error;
      if (!data) return out({ error: "別端末で退勤処理されました" }, 409);
      return out({ ok: true, shift: data });
    }
    return out({ error: "未対応の操作です" }, 400);
  } catch (e) {
    console.error(e);
    return out({ error: "処理できませんでした" }, 400);
  }
});
