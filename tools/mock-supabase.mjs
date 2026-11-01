#!/usr/bin/env node
// Servidor de PRUEBA que imita lo mínimo de la API de Supabase que usa el panel (auth, tablas y storage),
// con las mismas reglas de permiso que supabase/schema.sql. Sirve para probar el panel sin una cuenta real.
//   node tools/mock-supabase.mjs            (puerto 54321)
//   VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=test npm run dev
// Usuarios de prueba:  admin@test.com / secret123 (administrador)   ·   otro@test.com / secret123 (sin permiso)
import http from "node:http";

const PORT = Number(process.env.PORT || 54321);
const users = {
  "admin@test.com": { id: "11111111-1111-4111-8111-111111111111", password: "secret123", admin: true },
  "otro@test.com": { id: "22222222-2222-4222-8222-222222222222", password: "secret123", admin: false },
};
const byId = (id) => Object.entries(users).find(([, u]) => u.id === id);
const content = new Map(); // id -> { data, updated_at, updated_by }
let history = []; let hid = 1;
const files = new Map(); // "bucket/path" -> { buf, type }
const limits = { "site-media": 8388608, "hero-frames": 2097152 };

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "*" };
const send = (res, code, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(code, { ...cors, ...(isBuf || body === undefined ? {} : { "content-type": "application/json" }), ...headers });
  res.end(body === undefined ? undefined : isBuf ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const tokenOf = (id) => Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })).toString("base64url");
const session = (email) => {
  const u = users[email]; const exp = Math.floor(Date.now() / 1000) + 3600;
  const head = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  return { access_token: `${head}.${tokenOf(u.id)}.x`, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r-" + u.id,
    user: { id: u.id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
};
const who = (req) => {
  const a = req.headers.authorization || ""; const t = a.replace(/^Bearer\s+/i, "").split(".")[1];
  if (!t) return null;
  try { const p = JSON.parse(Buffer.from(t, "base64url").toString()); const e = byId(p.sub); return e ? { email: e[0], ...e[1] } : null; } catch { return null; }
};
const rls = (res) => send(res, 403, { code: "42501", message: "new row violates row-level security policy" });

// parte de un multipart/form-data con el archivo
function filePart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || ""); if (!m) return { buf, type: contentType };
  const bound = Buffer.from("--" + (m[1] || m[2])); let pos = 0;
  while (true) {
    const s = buf.indexOf(bound, pos); if (s < 0) break;
    const e = buf.indexOf(bound, s + bound.length); if (e < 0) break;
    const part = buf.subarray(s + bound.length + 2, e - 2);
    const he = part.indexOf("\r\n\r\n"); const head = part.subarray(0, he).toString();
    if (/filename=|name=""/.test(head)) return { buf: part.subarray(he + 4), type: (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1] };
    pos = e;
  }
  return { buf, type: contentType };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"); const p = url.pathname; const q = url.searchParams;
  if (req.method === "OPTIONS") return send(res, 204);
  const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : null;
  const json = () => { try { return JSON.parse(body.toString() || "{}"); } catch { return {}; } };
  const me = who(req);

  /* ---- auth ---- */
  if (p === "/auth/v1/token") {
    if (q.get("grant_type") === "refresh_token") { const e = byId(json().refresh_token?.replace("r-", "")); return e ? send(res, 200, session(e[0])) : send(res, 400, { error: "invalid_grant" }); }
    const { email, password } = json(); const u = users[email];
    return u && u.password === password ? send(res, 200, session(email)) : send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
  }
  if (p === "/auth/v1/user") return me ? send(res, 200, session(me.email).user) : send(res, 401, { msg: "no" });
  if (p === "/auth/v1/logout") return send(res, 204);

  /* ---- tablas ---- */
  const eq = (k) => (q.get(k) || "").replace(/^eq\./, "");
  if (p === "/rest/v1/admins" && req.method === "GET") {
    if (!me) return send(res, 200, []);
    return send(res, 200, me.admin && eq("user_id") === me.id ? [{ user_id: me.id }] : []);
  }
  if (p === "/rest/v1/site_content") {
    if (req.method === "GET") { const r = content.get(eq("id")); return send(res, 200, r ? [{ id: eq("id"), data: r.data, updated_at: r.updated_at }] : []); }
    if (req.method === "POST") {
      if (!me?.admin) return rls(res);
      const row = json();
      const old = content.get(row.id);
      if (old) { history.push({ id: hid++, content_id: row.id, data: old.data, saved_at: new Date().toISOString(), saved_by: old.updated_by }); history = history.slice(-30); }
      content.set(row.id, { data: row.data, updated_at: row.updated_at || new Date().toISOString(), updated_by: row.updated_by });
      return send(res, 201);
    }
  }
  if (p === "/rest/v1/site_content_history" && req.method === "GET") {
    if (!me?.admin) return send(res, 200, []);
    const rows = history.filter((h) => h.content_id === eq("content_id")).sort((a, b) => b.id - a.id).slice(0, Number(q.get("limit") || 20));
    return send(res, 200, rows.map(({ id, data, saved_at }) => ({ id, data, saved_at })));
  }

  /* ---- storage ---- */
  let m;
  if ((m = /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(p)) && req.method === "GET") {
    const f = files.get(`${m[1]}/${decodeURIComponent(m[2])}`);
    return f ? send(res, 200, f.buf, { "content-type": f.type || "application/octet-stream", "cache-control": "public, max-age=31536000" }) : send(res, 404, { error: "not_found" });
  }
  if ((m = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(p)) && req.method === "POST") {
    const bucket = m[1]; const { prefix = "", limit = 100, offset = 0 } = json(); const base = `${bucket}/${prefix ? prefix.replace(/\/?$/, "/") : ""}`;
    const seen = new Map();
    for (const k of files.keys()) if (k.startsWith(base)) { const rest = k.slice(base.length); const name = rest.split("/")[0]; seen.set(name, rest.includes("/") ? null : "file"); }
    const out = [...seen].map(([name, kind]) => ({ name, id: kind ? "id-" + name : null, updated_at: new Date().toISOString(), metadata: kind ? { size: 1 } : null })).slice(offset, offset + limit);
    return send(res, 200, out);
  }
  if ((m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(p)) && ["POST", "PUT"].includes(req.method)) {
    if (!me?.admin) return rls(res);
    const bucket = m[1], path = decodeURIComponent(m[2]);
    if (!limits[bucket]) return send(res, 404, { error: "Bucket not found" });
    const f = filePart(body, req.headers["content-type"]);
    if (f.buf.length > limits[bucket]) return send(res, 413, { error: "Payload too large" });
    if (bucket === "hero-frames" && f.type !== "image/webp") return send(res, 415, { error: "mime type not allowed" });
    files.set(`${bucket}/${path}`, { buf: f.buf, type: f.type });
    return send(res, 200, { Key: `${bucket}/${path}`, Id: "id-" + path });
  }
  if ((m = /^\/storage\/v1\/object\/([^/]+)$/.exec(p)) && req.method === "DELETE") {
    if (!me?.admin) return rls(res);
    const out = []; for (const pre of json().prefixes || []) if (files.delete(`${m[1]}/${pre}`)) out.push({ name: pre });
    return send(res, 200, out);
  }
  if (p === "/__state") return send(res, 200, { content: Object.fromEntries(content), history: history.length, files: [...files.keys()].length, sample: [...files.keys()].slice(0, 5) });
  send(res, 404, { error: "no existe", path: p });
}).listen(PORT, () => console.log(`Supabase de prueba en http://localhost:${PORT}  (admin@test.com / secret123)`));
