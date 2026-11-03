// Punto de entrada del receptor GPS. Lee la configuración del entorno (archivo .env o variables del sistema) y arranca.
import fs from "node:fs";
import { createServer } from "./server.js";
import { supabaseStore } from "./store.js";

// carga simple de un archivo .env (sin dependencias): KEY=valor por línea
const envFile = new URL("./.env", import.meta.url);
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const server = createServer({ store: supabaseStore({ url, key }) });

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { console.log(JSON.stringify({ level: "info", msg: "apagando: se guarda lo pendiente" })); await server.stop(); process.exit(0); });
process.on("uncaughtException", (e) => console.error(JSON.stringify({ level: "error", msg: "error no controlado", error: e.stack })));
process.on("unhandledRejection", (e) => console.error(JSON.stringify({ level: "error", msg: "promesa rechazada", error: String(e) })));

server.start().catch((e) => { console.error(JSON.stringify({ level: "error", msg: "no pudo arrancar", error: e.message })); process.exit(1); });
