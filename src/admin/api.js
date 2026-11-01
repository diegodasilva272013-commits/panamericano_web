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
  if (!/^image\//.test(file.type)) throw new Error("El archivo no es una imagen.");
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
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
