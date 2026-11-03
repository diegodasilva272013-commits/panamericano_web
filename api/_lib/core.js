// Lógica de los pagos online (Mercado Pago y transferencia por Talo). No depende de Vercel ni de Supabase:
// recibe la configuración (env), la forma de llamar a internet (fetch) y a la base (rpc), así se puede probar entera.
// Lo que manda el navegador nunca se toma como cierto: el monto sale siempre de la base y todo aviso de un proveedor
// se confirma consultándolo directamente al proveedor antes de registrar plata.
import crypto from "node:crypto";

const CODE = /^PB-[A-Z0-9]{6}$/;
const MP_API = "https://api.mercadopago.com";
const taloBase = (env) => (env.TALO_MODE === "live" ? "https://api.talo.com.ar" : "https://sandbox-api.talo.com.ar");

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
// fecha con el huso de Jujuy (-03:00), como la pide Mercado Pago
const arDate = (ms) => new Date(ms - 3 * 3600e3).toISOString().replace("Z", "-03:00");
const money = (n) => "$" + Math.round(n).toLocaleString("es-AR");

// Firma de los avisos de Mercado Pago: HMAC-SHA256 en hexadecimal de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
// con la clave secreta de la aplicación. Lo que falte en el aviso se omite del texto firmado.
export function verifyMpSignature({ xSignature, xRequestId, dataId, secret }) {
  if (!xSignature || !secret) return false;
  const parts = {};
  for (const s of String(xSignature).split(",")) { const i = s.indexOf("="); if (i > 0) parts[s.slice(0, i).trim()] = s.slice(i + 1).trim(); }
  if (!parts.ts || !parts.v1) return false;
  const ids = dataId == null || dataId === "" ? [""] : [...new Set([String(dataId), String(dataId).toLowerCase()])];
  return ids.some((id) => {
    let manifest = "";
    if (id) manifest += `id:${id};`;
    if (xRequestId) manifest += `request-id:${xRequestId};`;
    manifest += `ts:${parts.ts};`;
    return safeEq(crypto.createHmac("sha256", secret).update(manifest).digest("hex"), parts.v1);
  });
}

export function createCore({ env, fetch: doFetch = fetch, rpc, now = () => Date.now() }) {
  const site = String(env.SITE_URL || "").replace(/\/+$/, "");
  const enabled = () => ({
    mp: !!(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET && site),
    talo: !!(env.TALO_USER_ID && env.TALO_CLIENT_ID && env.TALO_CLIENT_SECRET && env.TALO_WEBHOOK_KEY && site),
  });
  const out = (status, json) => ({ status, json });
  const log = async (provider, kind, ref, ok, detail, payload) => {
    try { await rpc("pay_log", { p_provider: provider, p_kind: kind, p_ref: String(ref ?? ""), p_ok: ok, p_detail: String(detail || "").slice(0, 500), p_payload: payload ?? null }); } catch { /* la bitácora nunca rompe el cobro */ }
  };

  // llamada a un proveedor con tiempo máximo; nunca deja pasar claves a los mensajes de error
  async function http(url, init = {}, ms = 12000) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await doFetch(url, { ...init, signal: ctl.signal });
      let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
      return { status: res.status, ok: res.ok, json };
    } catch { return { status: 0, ok: false, json: null }; } finally { clearTimeout(timer); }
  }

  // ---------- Talo ----------
  let taloTok = null;
  async function taloToken(force = false) {
    if (!force && taloTok && now() - taloTok.at < 10 * 60e3) return taloTok.token;
    const r = await http(`${taloBase(env)}/users/${encodeURIComponent(env.TALO_USER_ID)}/tokens`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: env.TALO_CLIENT_ID, client_secret: env.TALO_CLIENT_SECRET }),
    });
    const token = r.json?.data?.token;
    if (!r.ok || !token) throw new Error(`Talo: no se pudo autenticar (${r.status})`);
    taloTok = { token, at: now() }; return token;
  }
  async function taloGet(path) {
    for (let i = 0; i < 2; i++) {
      const r = await http(`${taloBase(env)}${path}`, { headers: { Authorization: `Bearer ${await taloToken(i === 1)}` } });
      if (r.status !== 401 && r.status !== 403) return r;
    }
    return { status: 401, ok: false, json: null };
  }

  // ---------- crear el pago ----------
  async function createPayment({ code, method }) {
    if (!CODE.test(String(code || ""))) return out(400, { error: "datos", message: "El código de reserva no es válido." });
    if (method !== "mp" && method !== "talo") return out(400, { error: "datos", message: "Elegí un medio de pago." });
    if (!enabled()[method]) return out(503, { error: "no_disponible", message: "Este medio de pago todavía no está activado." });
    const ctx = await rpc("pay_context", { p_code: code });
    if (!ctx) return out(404, { error: "no_existe", message: "No encontramos esa reserva." });
    if (ctx.pending === 0) return out(409, { error: "estado", message: ctx.confirmed > 0 ? "Esa reserva ya está paga." : "Esa reserva ya no está vigente. Hacé una nueva." });
    if (ctx.expires && new Date(ctx.expires).getTime() <= now()) return out(409, { error: "vencida", message: "El tiempo para pagar esta reserva terminó. Hacé una nueva." });
    if (ctx.total == null) return out(422, { error: "sin_tarifa", message: "Esta reserva no tiene tarifa cargada. Confirmala con la boletería." });
    const due = Math.round((Number(ctx.total) - Number(ctx.paid || 0)) * 100) / 100;
    if (!(due > 0)) return out(409, { error: "estado", message: "Esa reserva ya está paga." });
    const title = `Pasaje ${ctx.from} → ${ctx.to} · ${String(ctx.date).slice(0, 10)} ${ctx.time} h`;
    const expMs = ctx.expires ? new Date(ctx.expires).getTime() : null;

    const open = await rpc("pay_order_open", { p_code: code, p_provider: method === "mp" ? "mercadopago" : "talo" });
    if (open && Number(open.amount) === due && (!open.data?.expires || new Date(open.data.expires).getTime() > now())) {
      const d = open.data || {};
      if (method === "mp" && d.init_point) return out(200, { method, url: d.init_point, amount: due });
      if (method === "talo" && d.cvu) return out(200, { method, cvu: d.cvu, alias: d.alias, amount: due, expires: d.expires || null, url: d.payment_url || null });
    }

    if (method === "mp") {
      const body = {
        items: [{ id: code, title, description: `Reserva ${code}`, quantity: 1, currency_id: "ARS", unit_price: due }],
        external_reference: code,
        notification_url: `${site}/api/webhooks/mp`,
        back_urls: { success: `${site}/?pago=${code}`, pending: `${site}/?pago=${code}`, failure: `${site}/?pago=${code}` },
        auto_return: "approved",
        binary_mode: true,
        statement_descriptor: "PANAMERICANO",
        ...(expMs ? { expires: true, expiration_date_from: arDate(now()), expiration_date_to: arDate(expMs) } : {}),
        ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.email || "") ? { payer: { email: ctx.email } } : {}),
      };
      const r = await http(`${MP_API}/checkout/preferences`, { method: "POST", headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok || !r.json?.id || !r.json?.init_point) {
        await log("mercadopago", "error", code, false, `crear preferencia: HTTP ${r.status} ${JSON.stringify(r.json || {}).slice(0, 300)}`);
        return out(502, { error: "proveedor", message: "No pudimos abrir Mercado Pago. Probá de nuevo en unos minutos o pagá por transferencia." });
      }
      await rpc("pay_order_save", { p_code: code, p_provider: "mercadopago", p_ref: String(r.json.id), p_amount: due, p_data: { init_point: r.json.init_point } });
      return out(200, { method, url: r.json.init_point, amount: due });
    }

    // Talo: un CVU y alias exclusivos para esta reserva
    let r;
    try {
      const body = {
        user_id: env.TALO_USER_ID, price: { amount: due, currency: "ARS" }, payment_options: ["transfer"], external_id: code,
        webhook_url: `${site}/api/webhooks/talo?k=${encodeURIComponent(env.TALO_WEBHOOK_KEY)}`, redirect_url: `${site}/?pago=${code}`, motive: title.slice(0, 120),
      };
      r = await http(`${taloBase(env)}/payments/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { r = { status: 0, ok: false, json: null }; }
    const d = r.json?.data, q = d?.quotes?.[0], cvu = q?.cvu || q?.address;
    if (!r.ok || !d?.id || !cvu) {
      await log("talo", "error", code, false, `crear pago: HTTP ${r.status} ${JSON.stringify(r.json || {}).slice(0, 300)}`);
      return out(502, { error: "proveedor", message: "No pudimos generar los datos de transferencia. Probá de nuevo en unos minutos o pagá con Mercado Pago." });
    }
    await rpc("pay_order_save", { p_code: code, p_provider: "talo", p_ref: String(d.id), p_amount: due, p_data: { cvu, alias: q.alias || "", payment_url: d.payment_url || null, expires: d.expiration_timestamp || null } });
    return out(200, { method, cvu, alias: q.alias || "", amount: due, expires: d.expiration_timestamp || null, url: d.payment_url || null });
  }

  // ---------- aplicar un pago ya verificado con el proveedor ----------
  async function applyMpPayment(p) {
    const code = String(p?.external_reference || "");
    if (!CODE.test(code)) { await log("mercadopago", "aviso", p?.id, false, "pago sin referencia de reserva válida"); return { applied: false }; }
    if (!(await rpc("pay_context", { p_code: code }))) { await log("mercadopago", "aviso", p.id, false, `reserva ${code} inexistente`); return { applied: false }; }
    if (p.currency_id && p.currency_id !== "ARS") { await log("mercadopago", "revision", p.id, false, `moneda ${p.currency_id}`); return { applied: false }; }
    const amount = Number(p.transaction_amount), refunded = Number(p.transaction_amount_refunded || 0);
    const note = `Mercado Pago${p.payment_method_id ? " · " + p.payment_method_id : ""}`;
    const st = String(p.status || "");
    let res = null;
    if (st === "approved" || st === "refunded" || st === "charged_back") {
      if (!(amount > 0)) { await log("mercadopago", "error", p.id, false, "monto inválido"); return { applied: false }; }
      res = await rpc("pay_register", { p_code: code, p_provider: "mercadopago", p_ref: String(p.id), p_kind: "cobro", p_amount: amount, p_method: "mercadopago", p_note: note, p_confirm: st === "approved" });
      const back = st === "approved" ? refunded : (refunded || amount);
      if (back > 0) await rpc("pay_sync_refund", { p_code: code, p_provider: "mercadopago", p_base_ref: String(p.id), p_refunded: back, p_method: "mercadopago" });
    }
    await log("mercadopago", "aviso", p.id, true, `estado ${st} · ${code} · ${amount}${res?.inserted === false ? " (ya registrado)" : ""}${res?.needs_refund ? " · REQUIERE DEVOLUCIÓN" : ""}`);
    return { applied: !!res?.inserted, res };
  }

  async function applyTaloPayment(order, payment) {
    const st = String(payment?.payment_status || "");
    const ext = payment?.external_id;
    if (ext && ext !== order.code) { await log("talo", "aviso", order.provider_ref, false, `external_id ${ext} no coincide con ${order.code}`); return { applied: false }; }
    if (st === "SUCCESS") {
      const paid = payment?.price?.amount;
      if (paid != null && Math.abs(Number(paid) - Number(order.amount)) > 0.009) {
        await rpc("pay_order_state", { p_provider: "talo", p_ref: order.provider_ref, p_state: "revision" });
        await log("talo", "revision", order.provider_ref, false, `monto distinto: orden ${order.amount}, Talo ${paid}`); return { applied: false };
      }
      const res = await rpc("pay_register", { p_code: order.code, p_provider: "talo", p_ref: order.provider_ref, p_kind: "cobro", p_amount: Number(order.amount), p_method: "transferencia", p_note: `Transferencia · Talo${order.data?.alias ? " · " + order.data.alias : ""}`, p_confirm: true });
      await log("talo", "aviso", order.provider_ref, true, `SUCCESS · ${order.code} · ${order.amount}${res?.inserted === false ? " (ya registrado)" : ""}${res?.needs_refund ? " · REQUIERE DEVOLUCIÓN" : ""}`);
      return { applied: !!res?.inserted, res };
    }
    if (st === "OVERPAID" || st === "UNDERPAID") {
      await rpc("pay_order_state", { p_provider: "talo", p_ref: order.provider_ref, p_state: "revision" });
      await log("talo", "revision", order.provider_ref, false, `${st} · ${order.code}: el monto transferido no es el pedido (${money(order.amount)}). Revisar a mano.`);
    } else if (st === "EXPIRED") {
      await rpc("pay_order_state", { p_provider: "talo", p_ref: order.provider_ref, p_state: "vencida" });
      await log("talo", "aviso", order.provider_ref, true, `EXPIRED · ${order.code}`);
    }
    return { applied: false };
  }

  // ---------- avisos (webhooks) ----------
  async function mpWebhook({ headers = {}, query = {}, body = null }) {
    const b = body && typeof body === "object" ? body : {};
    const dataId = query["data.id"] ?? b?.data?.id ?? null;
    if (!enabled().mp) return out(503, { error: "no_disponible" });
    const sig = verifyMpSignature({ xSignature: headers["x-signature"], xRequestId: headers["x-request-id"], dataId, secret: env.MP_WEBHOOK_SECRET });
    if (!sig) { await log("mercadopago", "firma_invalida", dataId, false, "aviso con firma inválida: se ignoró"); return out(401, { error: "firma" }); }
    const type = query.type ?? query.topic ?? b.type ?? b.topic;
    if (type !== "payment" || !dataId) return out(200, { ok: true, ignored: true });
    if (!/^\d{1,20}$/.test(String(dataId))) { await log("mercadopago", "aviso", dataId, false, "id de pago con formato raro"); return out(200, { ok: true, ignored: true }); }
    const r = await http(`${MP_API}/v1/payments/${dataId}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
    if (r.status === 404) { await log("mercadopago", "aviso", dataId, false, "el pago no existe en Mercado Pago (¿aviso de prueba?)"); return out(200, { ok: true, ignored: true }); }
    if (!r.ok || !r.json) return out(502, { error: "proveedor" });  // Mercado Pago reintenta solo
    const x = await applyMpPayment(r.json);
    return out(200, { ok: true, applied: x.applied });
  }

  async function taloWebhook({ query = {}, body = null }) {
    if (!enabled().talo) return out(503, { error: "no_disponible" });
    if (!safeEq(query.k ?? "", env.TALO_WEBHOOK_KEY)) { await log("talo", "firma_invalida", "", false, "aviso sin la clave del enlace: se ignoró"); return out(401, { error: "clave" }); }
    const id = body && typeof body === "object" ? body.paymentId : null;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{4,80}$/.test(id)) return out(400, { error: "datos" });
    const order = await rpc("pay_order_find", { p_provider: "talo", p_ref: id });
    if (!order) { await log("talo", "aviso", id, false, "pago desconocido (no hay orden nuestra con ese número)"); return out(200, { ok: true, ignored: true }); }
    // Talo todavía no firma sus avisos: lo único confiable es lo que Talo responde al consultarle directamente
    const r = await taloGet(`/payments/${encodeURIComponent(id)}`);
    if (r.status === 404) { await log("talo", "aviso", id, false, "Talo no conoce ese pago"); return out(200, { ok: true, ignored: true }); }
    if (!r.ok || !r.json?.data) return out(502, { error: "proveedor" });  // Talo reintenta
    const x = await applyTaloPayment(order, r.json.data);
    return out(200, { ok: true, applied: x.applied });
  }

  // ---------- estado para la web (con conciliación por si el aviso se demora) ----------
  const lastCheck = new Map();
  async function reconcile(code) {
    const t = now();
    if (t - (lastCheck.get(code) || 0) < 4000) return;
    lastCheck.set(code, t); if (lastCheck.size > 500) lastCheck.clear();
    if (enabled().mp) {
      const r = await http(`${MP_API}/v1/payments/search?external_reference=${encodeURIComponent(code)}&sort=date_created&criteria=desc&limit=10`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
      if (r.ok) for (const p of r.json?.results || []) if (p.external_reference === code) await applyMpPayment(p);
    }
    if (enabled().talo) {
      const order = await rpc("pay_order_open", { p_code: code, p_provider: "talo" });
      if (order) { const r = await taloGet(`/payments/${encodeURIComponent(order.provider_ref)}`); if (r.ok && r.json?.data) await applyTaloPayment(order, r.json.data); }
    }
  }
  async function status(code) {
    if (!CODE.test(String(code || ""))) return out(400, { error: "datos" });
    let s = await rpc("pay_public_status", { p_code: code });
    if (s?.state === "pendiente") {
      try { await reconcile(code); s = await rpc("pay_public_status", { p_code: code }); } catch { /* si falla la consulta, queda el estado de la base */ }
    }
    return out(200, { state: s?.state || "inexistente", expires: s?.expires || null });
  }

  return { enabled, createPayment, mpWebhook, taloWebhook, status, config: () => out(200, enabled()) };
}
