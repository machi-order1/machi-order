import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const allowedOrigins = new Set([
  "https://machi-order.pages.dev",
  "https://hakata-aburasoba-151.katsuhiro-yokota.chatgpt.site"
]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  };
}

function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (!origin || !allowedOrigins.has(origin)) return json(403, { error: "origin_not_allowed" }, origin);
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: "method_not_allowed" }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json(500, { error: "server_configuration" }, origin);
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const url = new URL(req.url);
    const storeId = Number(url.searchParams.get("store_id") || 1);
    if (storeId !== 1) return json(404, { error: "store_not_found" }, origin);

    const { data: setting } = await sb.from("store_channel_settings")
      .select("enabled,min_lead_minutes,max_advance_minutes").eq("store_id", storeId).eq("channel_code", "takeout").maybeSingle();
    if (!setting?.enabled) return json(409, { error: "takeout_unavailable" }, origin);

    if (req.method === "GET") {
      const { data: store, error: storeError } = await sb.from("stores")
        .select("id,name,timezone,brand_id,brands(name)").eq("id", storeId).single();
      if (storeError || !store) return json(404, { error: "store_not_found" }, origin);
      const [cats, products] = await Promise.all([
        sb.from("categories").select("id,name,parent_id,sort_order").eq("brand_id", store.brand_id).order("sort_order"),
        sb.from("products").select("id,name,description,base_price,category_id,sort_order,image_url")
          .eq("brand_id", store.brand_id).eq("active", true).eq("customer_visible", true).order("sort_order")
      ]);
      if (cats.error || products.error) throw cats.error || products.error;
      const ids = (products.data || []).map((p) => p.id);
      const [statuses, links] = await Promise.all([
        ids.length ? sb.from("store_products").select("product_id,sale_status").eq("store_id", storeId).in("product_id", ids) : Promise.resolve({ data: [], error: null }),
        ids.length ? sb.from("product_option_groups").select("product_id,option_group_id").in("product_id", ids) : Promise.resolve({ data: [], error: null })
      ]);
      if (statuses.error || links.error) throw statuses.error || links.error;
      const groupIds = [...new Set((links.data || []).map((x) => x.option_group_id))];
      const [groups, options] = await Promise.all([
        groupIds.length ? sb.from("option_groups").select("id,name,required,min_select,max_select").in("id", groupIds) : Promise.resolve({ data: [], error: null }),
        groupIds.length ? sb.from("options").select("id,option_group_id,name,price_delta,sort_order,source_product_id").in("option_group_id", groupIds).eq("active", true).order("sort_order") : Promise.resolve({ data: [], error: null })
      ]);
      if (groups.error || options.error) throw groups.error || options.error;
      const alcoholCategoryIds = new Set((cats.data || []).filter((c) => String(c.name).includes("アルコール")).map((c) => Number(c.id)));
      const takeoutProducts = (products.data || []).filter((p) => !alcoholCategoryIds.has(Number(p.category_id)));
      const statusMap = new Map((statuses.data || []).map((x) => [Number(x.product_id), x.sale_status]));
      return json(200, {
        brand: (store.brands as { name?: string } | null)?.name || "博多油そば151",
        store: store.name,
        settings: { min_lead_minutes: setting.min_lead_minutes || 10, max_advance_minutes: setting.max_advance_minutes || 1440 },
        categories: (cats.data || []).filter((c) => !alcoholCategoryIds.has(Number(c.id))),
        products: takeoutProducts.map((p) => ({
          ...p,
          price: p.base_price,
          sale_status: statusMap.get(Number(p.id)) || "available",
          option_group_ids: (links.data || []).filter((x) => Number(x.product_id) === Number(p.id)).map((x) => x.option_group_id)
        })),
        option_groups: (groups.data || []).map((g) => ({ ...g, options: (options.data || []).filter((o) => Number(o.option_group_id) === Number(g.id)).map((o) => ({ ...o, available: !o.source_product_id || (takeoutProducts.some((p) => Number(p.id) === Number(o.source_product_id)) && (statusMap.get(Number(o.source_product_id)) || 'available') === 'available') })) }))
      }, origin);
    }

    if (!(req.headers.get("content-type") || "").includes("application/json")) return json(415, { error: "invalid_content_type" }, origin);
    const body = await req.json().catch(() => ({}));
    if (clean(body.website, 200)) return json(200, { ok: true }, origin);
    const name = clean(body.name, 80);
    const phone = clean(body.phone, 30);
    const note = clean(body.note, 500);
    const pickupAt = clean(body.pickup_at, 60);
    const requestId = clean(body.request_id, 80).replace(/^takeout-/, "");
    const items = Array.isArray(body.items) ? body.items.slice(0, 30).map((item: Record<string, unknown>) => ({
      product_id: Number(item.product_id),
      quantity: Math.max(1, Math.min(20, Number(item.quantity) || 1)),
      option_ids: Array.isArray(item.option_ids) ? item.option_ids.map(Number).filter(Number.isFinite).slice(0, 20) : []
    })).filter((item) => Number.isInteger(item.product_id) && item.product_id > 0) : [];
    if (!name || !phone || !pickupAt || !items.length) return json(400, { error: "required_fields" }, origin);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return json(400, { error: "invalid_request_id" }, origin);
    if (phone.replace(/\D/g, "").length < 8) return json(400, { error: "invalid_phone" }, origin);
    const parsedPickup = new Date(pickupAt);
    if (Number.isNaN(parsedPickup.getTime())) return json(400, { error: "invalid_pickup_time" }, origin);

    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ipHash = await sha256("151-takeout-v1:" + forwarded);
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count, error: rateError } = await sb.from("takeout_order_details")
      .select("order_id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since);
    if (rateError) throw rateError;
    if ((count || 0) >= 3) return json(429, { error: "too_many_requests" }, origin);

    const { data, error } = await sb.rpc("place_takeout_order_idempotent", {
      p_store_id: storeId,
      p_items: items,
      p_client_order_key: requestId,
      p_customer_name: name,
      p_phone: phone,
      p_pickup_at: parsedPickup.toISOString(),
      p_customer_note: note || null,
      p_ip_hash: ipHash,
      p_user_agent: clean(req.headers.get("user-agent"), 500) || null
    });
    if (error) {
      const message = String(error.message || "");
      if (message.includes("営業時間外")) return json(409, { error: "outside_business_hours" }, origin);
      if (message.includes("売り切れ") || message.includes("販売停止")) return json(409, { error: "item_unavailable" }, origin);
      if (message.includes("受取時刻")) return json(400, { error: "invalid_pickup_time" }, origin);
      console.error(error);
      return json(400, { error: "order_rejected" }, origin);
    }
    return json(201, { ok: true, ...data }, origin);
  } catch (error) {
    console.error(error);
    return json(500, { error: "system_error" }, origin);
  }
});

