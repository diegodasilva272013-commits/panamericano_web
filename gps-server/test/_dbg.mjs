// Punta a punta: servidor receptor real (UDP/TCP) + simulador de equipo Rinho + motor + Postgres con todo el SQL del proyecto.
import dgram from "node:dgram";
import net from "node:net";
import { freshDb, rpc } from "./helpers.mjs";
import { createServer } from "../server.js";
import { SimDevice } from "../sim-device.js";
import { encodePosition, frame } from "../taip.js";
import { cumulative } from "../geo.js";
import { drive, pointAt, TEST_LINE } from "../sim-route.js";

const DEVICE = "860012345678901";
const CUM = cumulative(TEST_LINE), L = CUM.at(-1);
const ALONG = [0, Math.round(L * 0.3), Math.round(L * 0.65), Math.round(L)];
const NAMES = ["Terminal Jujuy", "Purmamarca", "Humahuaca", "La Quiaca"];
const q = (db, sql, args = []) => db.query(sql, args).then((r) => r.rows);
const quiet = () => {};

// "hoy" en Jujuy y la hora programada de la salida (06:15)
const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const PLANNED = Date.parse(`${today}T06:15:00-03:00`);

async function seed(db) {
  const [v] = await q(db, `insert into vehicles(code, device_id) values ('INT 110', $1) returning id`, [DEVICE]);
  const gids = [];
  for (let i = 0; i < 4; i++) {
    const p = pointAt(TEST_LINE, CUM, ALONG[i]);
    gids.push((await q(db, `insert into geofences(name, kind, shape, lat, lng, radius_m) values ($1, $2, 'circle', $3, $4, 150) returning id`, [NAMES[i], i === 0 || i === 3 ? "terminal" : "parada", p.lat, p.lng]))[0].id);
  }
  await q(db, `insert into fleet_routes(route_id, polyline, corridor_m) values ('r1', $1, 400)`, [JSON.stringify(TEST_LINE)]);
  for (let i = 0; i < 4; i++) await q(db, `insert into fleet_route_stops(route_id, idx, geofence_id, name, offset_min) values ('r1', $1, $2, $3, $4)`, [i, gids[i], NAMES[i], i === 0 ? 0 : null]);
  const [t] = await q(db, `insert into fleet_trips(route_id, trip_date, trip_time, vehicle_id, planned_at) values ('r1', $1, '06:15', $2, $3) returning id`, [today, v.id, new Date(PLANNED).toISOString()]);
  return { vid: v.id, tid: t.id, gids };
}

// store conectado al Postgres de prueba; las llamadas se hacen de a una (una sola conexión)
function pgStore(db, hooks = {}) {
  const call = rpc(db, "service_role");
  let chain = Promise.resolve();
  const serial = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
  return {
    config: () => serial(() => call("gps_config")),
    save: (p) => serial(async () => { const info = { pos: p.positions?.length, first: p.positions?.[0]?.t, trips: (p.trips||[]).map(t=>t.status), stops: (p.stops||[]).length, ev: (p.events||[]).map(e=>e.kind) }; if (hooks.failSave > 0) { hooks.failSave--; console.log("SAVE FALLA", JSON.stringify(info)); throw new Error("base caída (simulado)"); } console.log("SAVE OK", JSON.stringify(info)); return call("gps_save", { p }); }),
    unknown: (p) => serial(() => call("gps_unknown", { p })),
    purge: () => serial(() => call("gps_purge", {})),
  };
}

async function boot({ env = {}, hooks = {} } = {}) {
  const db = await freshDb();
  const ids = await seed(db);
  const server = createServer({ store: pgStore(db, hooks), env: { UDP_PORT: "0", TCP_PORT: "0", HEALTH_PORT: "0", FLUSH_MS: "20", CONFIG_REFRESH_S: "3600", SWEEP_S: "3600", ...env }, log: quiet });
  await server.start();
  const devs = [];
  const device = async (o = {}) => { const d = await new SimDevice({ deviceId: DEVICE, port: o.transport === "tcp" ? server.ports().tcp : server.ports().udp, ackTimeoutMs: 350, window: 60, ...o }).connect(); devs.push(d); return d; };
  const done = async () => { for (const d of devs) await d.close(); await server.stop(); };
  return { db, ...ids, server, device, done };
}
const trip = (o = {}) => drive({ line: TEST_LINE, startMs: PLANNED, dwellAtStart: 60, stops: [{ along: ALONG[1], dwellS: 60 }, { along: ALONG[2], dwellS: 60 }], ...o });

// manda un texto crudo por UDP y devuelve lo que contesta el servidor (o null si no contesta)
const rawUdp = (port, text, wait = 400) => new Promise((resolve) => {
  const s = dgram.createSocket("udp4"); let got = null;
  s.on("message", (m) => { got = m.toString("latin1"); });
  s.send(Buffer.from(text, "latin1"), port, "127.0.0.1", () => setTimeout(() => { s.close(); resolve(got); }, wait));
});


const t = await boot({ hooks: { failSave: 3 } });
const dev = await t.device();
const ps = trip().slice(0, 150);
await dev.sendAll(ps);
console.log("estado viaje:", JSON.stringify(await q(t.db, `select status from fleet_trips`)));
console.log("stats", JSON.stringify(t.server.stats));
await t.done(); process.exit(0);
