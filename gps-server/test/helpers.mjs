// Base de prueba con TODO el SQL real del proyecto (schema + booking + erp + pagos + flota) en un Postgres en memoria.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const SQL = fileURLToPath(new URL("../../supabase/", import.meta.url));

export async function makeDb({ flota = true } = {}) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
   create table auth.users(id uuid primary key, email text);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
   grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;`);
  let schema = fs.readFileSync(SQL + "schema.sql", "utf8");
  schema = schema.slice(0, schema.indexOf("-- 4) ARCHIVOS")); // la parte de archivos usa el almacenamiento de Supabase, que acá no existe
  await db.exec(schema);
  for (const f of ["booking.sql", "erp.sql", "pagos.sql", ...(flota ? ["flota.sql", "envivo.sql"] : [])]) await db.exec(fs.readFileSync(SQL + f, "utf8"));
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
  return db;
}

// Arrancar PGlite tarda (varios segundos, y más si la carpeta está en OneDrive): se arma una sola vez por archivo de prueba
// y entre prueba y prueba se vacían las tablas de datos.
let shared = null;
export async function freshDb() {
  shared ??= makeDb();
  const db = await shared;
  await db.exec(`truncate gps_positions, vehicle_state, geofence_events, fleet_alerts, fleet_trip_stops, fleet_trips, fleet_route_stops, fleet_routes, geofences, gps_unknown_devices, vehicles restart identity cascade;
    delete from admins; delete from auth.users;
    update fleet_settings set data = data;`);
  return db;
}

// ejecuta fn con el rol indicado (service_role = el servidor receptor, authenticated = el ERP, anon = la web pública)
export const as = async (db, role, fn, sub = "") => {
  await db.exec(`set role ${role}; select set_config('request.jwt.sub', '${sub}', false);`);
  try { return await fn(); } finally { await db.exec("reset role"); }
};

// llamada a una función como lo hace supabase-js: argumentos con nombre, jsonb como texto
export const rpc = (db, role = "service_role", sub = "") => async (fn, args = {}) => {
  const keys = Object.keys(args);
  const vals = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
  const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
  return as(db, role, async () => (await db.query(sql, vals)).rows[0].r, sub);
};
