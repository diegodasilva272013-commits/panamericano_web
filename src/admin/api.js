import { createClient } from "@supabase/supabase-js";
import { SUPABASE } from "../scripts/config.js";
import { DEFAULT_CONTENT } from "../content/defaults.js";
import { mergeContent } from "../scripts/data.js";

export const configured = !!(SUPABASE.url && SUPABASE.anonKey);
export const sb = configured
  ? createClient(SUPABASE.url, SUPABASE.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "pm-admin-auth" } })
  : null;

export const BUCKET_MEDIA = "site-media";
export const BUCKET_FRAMES = "hero-frames";

/* ---------- sesion ---------- */
export const getSession = async () => (await sb.auth.getSession()).data.session;
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(/invalid/i.test(error.message) ? "Email o contraseña incorrectos." : error.message);
  return data.session;
}
export const signOut = () => sb.auth.signOut();
export async function isAdmin(userId) {
  const { data, error } = await sb.from("admins").select("user_id").eq("user_id", userId).limit(1);
  if (error) throw new Error("No se pudo comprobar el permiso: " + error.message);
  return !!data?.length;
}

/* ---------- contenido ---------- */
export async function fetchRemote() {
  const { data, error } = await sb.from("site_content").select("data,updated_at").eq("id", "main").limit(1);
  if (error) throw new Error("No se pudo leer el contenido: " + error.message);
  return data?.[0] || null;
}
// solo la fecha de la última publicación (para consultar cada minuto sin bajar todo el contenido)
export async function fetchStamp() {
  const { data, error } = await sb.from("site_content").select("updated_at").eq("id", "main").limit(1);
  if (error) throw new Error("No se pudo leer el contenido: " + error.message);
  return data?.[0]?.updated_at || null;
}
export const withDefaults = (remote) => mergeContent(structuredClone(DEFAULT_CONTENT), remote || {});

// expectedAt: la versión que cargaste. Si otra persona publicó después, la base no escribe y se avisa (code CONFLICT).
export async function saveContent(data, userId, expectedAt) {
  const at = new Date().toISOString();
  if (expectedAt) {
    const { data: rows, error: e1 } = await sb.from("site_content").update({ data, updated_by: userId, updated_at: at }).eq("id", "main").eq("updated_at", expectedAt).select("updated_at");
    if (e1) throw new Error("No se pudo guardar: " + e1.message);
    if (!rows?.length) { const c = new Error("Otra persona publicó antes."); c.code = "CONFLICT"; throw c; }
    return at;
  }
  const { error } = await sb.from("site_content").upsert({ id: "main", data, updated_by: userId, updated_at: at }, { onConflict: "id" });
  if (error) throw new Error("No se pudo guardar: " + error.message);
  return at; // la hora exacta que quedó guardada (sirve para detectar si otra persona publicó antes)
}

export async function listHistory() {
  const { data, error } = await sb.from("site_content_history").select("id,data,saved_at").eq("content_id", "main").order("saved_at", { ascending: false }).limit(20);
  if (error) throw new Error("No se pudo leer el historial: " + error.message);
  return data || [];
}

/* ---------- archivos ---------- */
export const publicUrl = (bucket, path) => sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;

export async function uploadBlob(bucket, path, blob, contentType) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType, cacheControl: "31536000", upsert: true });
    if (!error) return publicUrl(bucket, path);
    lastErr = error; await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw new Error("No se pudo subir el archivo: " + (lastErr?.message || "error de red"));
}

// Achica y convierte a WebP antes de subir: un cliente que sube una foto de 6 MB del celular no vuelve lenta la web.
export async function prepareImage(file, { maxWidth = 1600, quality = 0.82 } = {}) {
  if (!/^image\//.test(file.type)) throw Object.assign(new Error("Ese archivo no es una imagen. Elegí una foto JPG, PNG o WebP."), { noRetry: true });
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw Object.assign(new Error("Esa imagen no se puede abrir. Probá con una foto JPG, PNG o WebP. Si viene de un iPhone en formato HEIC, pasala a JPG primero."), { noRetry: true }); }
  const scale = Math.min(1, maxWidth / bmp.width);
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, "image/webp", quality));
  if (!blob || blob.type !== "image/webp") throw new Error("Este navegador no puede convertir imágenes. Usá Chrome o Edge.");
  return { blob, width: w, height: h, before: file.size, after: blob.size };
}
const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "imagen";
export async function uploadImage(file, opts = {}) {
  const p = await prepareImage(file, opts);
  const path = `img/${Date.now().toString(36)}-${slug(file.name)}.webp`;
  const url = await uploadBlob(BUCKET_MEDIA, path, p.blob, "image/webp");
  return { url, ...p };
}

/* ---------- versiones del hero (cuadros) ---------- */
export async function listFrameVersions() {
  const { data, error } = await sb.storage.from(BUCKET_FRAMES).list("", { limit: 200 });
  if (error) throw new Error(error.message);
  return (data || []).filter((x) => !x.id && x.name).map((x) => x.name); // carpetas
}
export async function removeFrameVersion(version) {
  for (const juego of ["desktop", "mobile"]) {
    for (;;) {
      const { data } = await sb.storage.from(BUCKET_FRAMES).list(`${version}/${juego}`, { limit: 500 });
      if (!data?.length) break;
      const { error } = await sb.storage.from(BUCKET_FRAMES).remove(data.map((f) => `${version}/${juego}/${f.name}`));
      if (error) throw new Error(error.message);
    }
  }
  const { data: rest } = await sb.storage.from(BUCKET_FRAMES).list(version, { limit: 50 });
  if (rest?.length) await sb.storage.from(BUCKET_FRAMES).remove(rest.filter((f) => f.id).map((f) => `${version}/${f.name}`));
}

/* ---------- reservas (datos vivos: se guardan al instante, no pasan por "Guardar y publicar") ---------- */
const clean = (q) => String(q).replace(/[^\p{L}\p{N}@+. -]/gu, " ").replace(/\s+/g, " ").trim();
function resErr(e, what) {
  if (e?.code === "23P01") { const c = new Error("Ese asiento ya está ocupado en ese tramo."); c.code = "SEAT_TAKEN"; return c; }
  console.warn("[reservas]", what, e?.message || e);
  return new Error(`No se pudo ${what}. Revisá tu conexión y probá de nuevo; si sigue igual, avisá a quien administra la web.`);
}
// reservas de un día (y opcionalmente de un servicio/horario)
export async function listReservations({ date, route, time }) {
  let q = sb.from("reservations").select("*").eq("trip_date", date).order("trip_time").order("seat", { ascending: true }).limit(1000);
  if (route) q = q.eq("route_id", route); if (time) q = q.eq("trip_time", time);
  const { data, error } = await q; if (error) throw resErr(error, "leer las reservas");
  return data || [];
}
// buscar por código, nombre, teléfono o documento (todas las fechas, las más nuevas primero)
export async function searchReservations(text) {
  const t = clean(text); if (t.length < 2) return [];
  const { data, error } = await sb.from("reservations").select("*")
    .or(`code.ilike.%${t}%,passenger_name.ilike.%${t}%,phone.ilike.%${t}%,passenger_doc.ilike.%${t}%`)
    .order("trip_date", { ascending: false }).limit(80);
  if (error) throw resErr(error, "buscar");
  return data || [];
}
export async function setReservationStatus(ids, status) {
  const { error } = await sb.from("reservations").update({ status }).in("id", ids);
  if (error) throw resErr(error, "cambiar la reserva");
}
export async function setReservationNote(id, note) {
  const { error } = await sb.from("reservations").update({ note: String(note).slice(0, 300) }).eq("id", id);
  if (error) throw resErr(error, "guardar la nota");
}
export async function deleteReservations(ids) {
  const { error } = await sb.from("reservations").delete().in("id", ids);
  if (error) throw resErr(error, "borrar la reserva");
}
// una reserva cargada a mano (boletería / teléfono): una fila por asiento, mismo código
export async function addReservation({ route, date, time, from, to, fromName, toName, seats, people, phone, email, fare, status, note }) {
  const code = "PB-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32]).join("");
  const rows = seats.map((seat, i) => ({ code, route_id: route, trip_date: date, trip_time: time, from_idx: from, to_idx: to, from_name: fromName, to_name: toName, seat,
    passenger_name: people[i].name, passenger_doc: people[i].doc || "", phone: phone || "", email: email || "", fare: fare ?? null, status: status || "confirmada", note: note || "", source: "admin" }));
  const { error } = await sb.from("reservations").insert(rows);
  if (error) throw resErr(error, "cargar la reserva");
  return code;
}
export async function listClosed(date) {
  const { data, error } = await sb.from("closed_trips").select("*").eq("trip_date", date);
  if (error) throw resErr(error, "leer las salidas cerradas");
  return data || [];
}
export async function closeTrip({ route, date, time, reason }) {
  const { error } = await sb.from("closed_trips").insert({ route_id: route, trip_date: date, trip_time: time || null, reason: reason || "" });
  if (error && error.code !== "23505") throw resErr(error, "cerrar la salida");
}
export async function openTrip(id) {
  const { error } = await sb.from("closed_trips").delete().eq("id", id);
  if (error) throw resErr(error, "reabrir la salida");
}
// cuántas reservas vivas hay por día entre dos fechas (para el Resumen y el selector de fecha)
export async function countByDay(from, to) {
  const { data, error } = await sb.from("reservations").select("trip_date,code,status").gte("trip_date", from).lte("trip_date", to).neq("status", "cancelada").limit(5000);
  if (error) throw resErr(error, "contar las reservas");
  const m = {}; (data || []).forEach((r) => { (m[r.trip_date] ||= new Set()).add(r.code); });
  return Object.fromEntries(Object.entries(m).map(([d, s]) => [d, s.size]));
}

// para el Resumen: reservas por confirmar (de hoy en adelante) y reservas de hoy. Si la tabla no existe todavía, avisa que falta activar.
export async function bookingSummary(today) {
  const { data, error } = await sb.from("reservations").select("code,status,trip_date").gte("trip_date", today).neq("status", "cancelada").limit(5000);
  if (error) return { setup: /relation|does not exist|PGRST205|42P01/i.test(`${error.code} ${error.message}`), failed: true };
  const pend = new Set(), hoy = new Set();
  (data || []).forEach((r) => { if (r.status === "pendiente") pend.add(r.code); if (String(r.trip_date).slice(0, 10) === today) hoy.add(r.code); });
  return { pending: pend.size, today: hoy.size };
}
