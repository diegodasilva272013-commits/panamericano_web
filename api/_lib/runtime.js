// Conecta la lógica de pagos con el entorno real: variables de Vercel y la base de Supabase con la clave de servicio.
// La clave de servicio vive SOLO en Vercel (variable de entorno). Nunca va al navegador ni al repositorio.
import { createClient } from "@supabase/supabase-js";
import { createCore } from "./core.js";

let core = null;
export function getCore() {
  if (core) return core;
  const env = process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw Object.assign(new Error(`${fn}: ${error.message}`), { code: error.code });
    return data;
  };
  core = createCore({ env, rpc });
  return core;
}

// Adaptador común: ejecuta una acción del core y escribe la respuesta. Nada de datos sensibles en los errores.
export async function respond(req, res, allowed, run) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!allowed.includes(req.method)) { res.setHeader("Allow", allowed.join(", ")); res.status(405).json({ error: "metodo" }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  let query = req.query;
  if (!query) { try { query = Object.fromEntries(new URL(req.url, "http://x").searchParams); } catch { query = {}; } }
  try {
    const { status, json } = await run(getCore(), { headers: req.headers || {}, query, body });
    res.status(status).json(json);
  } catch (e) {
    console.error("[pagos]", e?.message);
    res.status(500).json({ error: "interno", message: "No pudimos completar la operación. Probá de nuevo." });
  }
}
