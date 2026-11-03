// Punta a punta: servidor receptor real (UDP/TCP) + simulador de equipo Rinho + motor + Postgres con todo el SQL del proyecto.
import test from "node:test";
import assert from "node:assert/strict";
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
    save: (p) => serial(async () => { if (hooks.failSave > 0) { hooks.failSave--; throw new Error("base caída (simulado)"); } return call("gps_save", { p }); }),
    unknown: (p) => serial(() => call("gps_unknown", { p })),
    purge: () => serial(() => call("gps_purge", {})),
    positionsSince: (vehicleId, fromIso, limit = 20000) => serial(() => call("gps_positions_since", { p_vehicle: vehicleId, p_from: fromIso, p_limit: limit })),
  };
}

async function boot({ env = {}, hooks = {} } = {}) {
  const db = await freshDb();
  const ids = await seed(db);
  const server = createServer({ store: pgStore(db, hooks), env: { UDP_PORT: "0", TCP_PORT: "0", HEALTH_PORT: "0", FLUSH_MS: "20", LAG_MS: "0", DRAIN_MS: "20", CONFIG_REFRESH_S: "3600", SWEEP_S: "3600", ...env }, log: quiet });
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

test("viaje completo por UDP: todo se confirma, se guarda una vez y el viaje se arma solo", async () => {
  const t = await boot();
  try {
    const dev = await t.device();
    const ps = trip();
    const res = await dev.sendAll(ps);
    assert.ok(res.every((r) => r.acked), "el servidor confirmó cada reporte");
    assert.equal(dev.lost, 0);
    await t.server.settle();
    assert.equal((await q(t.db, `select count(*)::int n from gps_positions`))[0].n, ps.length);
    const [tr] = await q(t.db, `select status, last_stop_idx, distance_m::int d, max_speed from fleet_trips`);
    assert.equal(tr.status, "completado"); assert.equal(tr.last_stop_idx, 3); assert.ok(tr.d > 100_000); assert.ok(tr.max_speed >= 70);
    const stops = await q(t.db, `select idx, status, dwell_s from fleet_trip_stops order by idx`);
    assert.deepEqual(stops.map((s) => s.status), ["ok", "ok", "ok", "ok"]);
    assert.ok(stops[1].dwell_s >= 50);
    assert.equal((await q(t.db, `select count(*)::int n from fleet_alerts`))[0].n, 0);
    const [st] = await q(t.db, `select speed, ignition, trip_id from vehicle_state`);
    assert.equal(st.trip_id, null);
    const ev = await q(t.db, `select kind from geofence_events where geofence_id = $1 order by at`, [t.gids[1]]);
    assert.deepEqual(ev.map((e) => e.kind), ["entra", "sale"]);
    assert.equal(t.server.stats.badChecksum, 0, "el simulador firma bien: ninguna trama con checksum dudoso");
  } finally { await t.done(); }
});

test("se pierden ACKs en el camino: el equipo reintenta y no se duplica ni una posición ni un evento", async () => {
  const t = await boot();
  try {
    const dev = await t.device({ dropAcks: 25 });
    const ps = trip().slice(0, 200);
    const res = await dev.sendAll(ps);
    assert.ok(res.every((r) => r.acked));
    assert.ok(dev.retransmits >= 20, `hubo reenvíos (${dev.retransmits})`);
    await t.server.settle();
    assert.equal((await q(t.db, `select count(*)::int n from gps_positions`))[0].n, ps.length, "una fila por reporte, sin duplicados");
    assert.equal((await q(t.db, `select count(*)::int n from geofence_events where geofence_id = $1`, [t.gids[0]]))[0].n, 2);
  } finally { await t.done(); }
});

test("la base se cae: no se confirma, el equipo reintenta y al volver queda todo guardado, sin eventos perdidos ni repetidos", async () => {
  const hooks = { failSave: 3 };
  const t = await boot({ hooks });
  try {
    const dev = await t.device();
    const ps = trip().slice(0, 150); // incluye parada en el origen y la salida (arranca el viaje)
    const res = await dev.sendAll(ps);
    assert.ok(res.every((r) => r.acked), "al final se confirmó todo");
    await t.server.settle();
    assert.ok(t.server.stats.saveErrors + t.server.stats.engineErrors >= 1, "hubo fallos de guardado");
    assert.ok(dev.retransmits > 0);
    assert.equal((await q(t.db, `select count(*)::int n from gps_positions`))[0].n, ps.length);
    assert.equal((await q(t.db, `select status from fleet_trips`))[0].status, "en_curso");
    const ev = await q(t.db, `select kind from geofence_events where geofence_id = $1 order by at, id`, [t.gids[0]]);
    assert.deepEqual(ev.map((e) => e.kind), ["entra", "sale"], "las geocercas del origen se registraron una sola vez");
  } finally { await t.done(); }
});

test("por TCP también: tramas pegadas, partidas y confirmaciones por la misma conexión", async () => {
  const t = await boot();
  try {
    const dev = await t.device({ transport: "tcp" });
    const ps = trip().slice(0, 120);
    const res = await dev.sendAll(ps);
    assert.ok(res.every((r) => r.acked));
    assert.equal((await q(t.db, `select count(*)::int n from gps_positions`))[0].n, ps.length);
    // varias tramas en un solo envío TCP, partidas en cualquier lado
    const sock = new net.Socket(); await new Promise((r) => sock.connect(t.server.ports().tcp, "127.0.0.1", r));
    let got = ""; sock.on("data", (d) => { got += d.toString("latin1"); });
    const text = [0x7000, 0x7001, 0x7002].map((n, i) => encodePosition({ ...ps[119], t: ps[119].t + (i + 1) * 7000 }, { msgNum: n, deviceId: DEVICE, reportId: 200 + i })).join("");
    for (let i = 0; i < text.length; i += 17) { sock.write(text.slice(i, i + 17)); await new Promise((r) => setTimeout(r, 2)); }
    await new Promise((r) => setTimeout(r, 300)); sock.destroy();
    assert.equal((got.match(/>ACK;#700[012]/g) || []).length, 3, "las tres tramas se confirmaron");
  } finally { await t.done(); }
});

test("un equipo que no está cargado en el ERP no se acepta: sin confirmación y queda a la vista para vincularlo", async () => {
  const t = await boot();
  try {
    const intruso = await t.device({ deviceId: "999000111222333", retries: 1, ackTimeoutMs: 100 });
    const res = await intruso.sendAll(trip().slice(0, 3));
    assert.ok(res.every((r) => !r.acked));
    assert.equal((await q(t.db, `select count(*)::int n from gps_positions`))[0].n, 0);
    await t.server.flushUnknown();
    const u = await q(t.db, `select device_id, frames::int f from gps_unknown_devices`);
    assert.equal(u.length, 1); assert.equal(u[0].device_id, "999000111222333"); assert.ok(u[0].f >= 3);
  } finally { await t.done(); }
});

test("checksum: en modo 'warn' una trama alterada se acepta y se cuenta; en modo 'strict' se rechaza sin confirmar", async () => {
  const mk = (n) => encodePosition({ ...trip()[0], t: PLANNED + n * 7000 }, { msgNum: 0x100 + n, deviceId: DEVICE, reportId: n });
  const bad = (s) => s.replace("-2418500", "-2418501");
  const w = await boot();
  try {
    const good = mk(1), broken = bad(mk(2));
    assert.notEqual(broken, mk(2));
    assert.match(await rawUdp(w.server.ports().udp, good), />ACK;#0101/);
    assert.match(await rawUdp(w.server.ports().udp, broken), />ACK;#0102/, "warn: acepta");
    assert.equal(w.server.stats.badChecksum, 1);
  } finally { await w.done(); }
  const s = await boot({ env: { CHECKSUM: "strict" } });
  try {
    assert.match(await rawUdp(s.server.ports().udp, mk(1)), />ACK;#0101/);
    assert.equal(await rawUdp(s.server.ports().udp, bad(mk(2))), null, "strict: descarta y no confirma");
    assert.equal(s.server.stats.rejected.checksum, 1);
  } finally { await s.done(); }
});

test("basura en la red y datagramas rotos no tiran el servidor ni bloquean a los equipos", async () => {
  const t = await boot();
  try {
    const port = t.server.ports().udp;
    for (const junk of ["\x00\x01\x02", ">>>><<<<", ">RCQ<", "hola mundo", ">" + "A".repeat(5000) + "<", ">ID=;*00<", "\xff\xfe\xfd"]) await rawUdp(port, junk, 10);
    const tcp = new net.Socket(); await new Promise((r) => tcp.connect(t.server.ports().tcp, "127.0.0.1", r));
    tcp.write(">".repeat(40000)); tcp.write("basura sin cerrar"); await new Promise((r) => setTimeout(r, 100)); tcp.destroy();
    const ok = encodePosition(trip()[0], { msgNum: 0x55, deviceId: DEVICE, reportId: 1 });
    assert.match(await rawUdp(port, ok), />ACK;#0055/, "después de la basura, un equipo legítimo sigue siendo atendido");
  } finally { await t.done(); }
});

test("sin posición satelital (0,0) o con fecha imposible: se confirma pero no se guarda", async () => {
  const t = await boot();
  try {
    const port = t.server.ports().udp, base = trip()[0];
    assert.match(await rawUdp(port, encodePosition({ ...base, lat: 0, lng: 0 }, { msgNum: 0x61, deviceId: DEVICE })), />ACK;#0061/);
    assert.match(await rawUdp(port, encodePosition({ ...base, t: Date.UTC(2030, 0, 1) }, { msgNum: 0x62, deviceId: DEVICE })), />ACK;#0062/);
    await t.server.flush();
    assert.equal((await q(t.db, `select count(*)::int n from gps_positions`))[0].n, 0);
    assert.equal(t.server.stats.noFix, 2);
  } finally { await t.done(); }
});

test("un coche en servicio que deja de transmitir genera la alerta 'sin señal'", async () => {
  const t = await boot();
  try {
    const dev = await t.device();
    await dev.sendAll(trip().slice(0, 80));
    await t.server.settle();
    const real = Date.now;
    Date.now = () => real() + 11 * 60_000; // pasan 11 minutos
    try { await t.server.sweep(); } finally { Date.now = real; }
    const a = await q(t.db, `select kind, ended_at from fleet_alerts`);
    assert.deepEqual(a.map((x) => x.kind), ["sin_senal"]);
  } finally { await t.done(); }
});

test("estado de salud: el servidor informa que está listo y cuántas tramas confirmó", async () => {
  const t = await boot();
  try {
    const dev = await t.device(); await dev.sendAll(trip().slice(0, 5));
    const r = await fetch(`http://127.0.0.1:${t.server.ports().health}/`).then((x) => x.json());
    assert.equal(r.ok, true); assert.equal(r.ready, true); assert.ok(r.acked >= 5);
  } finally { await t.done(); }
});

test("el equipo manda en el formato real de otros tipos (HQ con horómetro, CR con temperatura): se aceptan y se guardan los extras", async () => {
  const t = await boot();
  try {
    const dev = await t.device({ kind: "HR" });
    await dev.sendAll(trip().slice(0, 3), { backupV: 4.12, engineS: 3600, temp0: { c: 22.5, ageS: 3 } });
    const [r] = await q(t.db, `select rtype, extra from gps_positions order by event_time limit 1`);
    assert.equal(r.rtype, "HR"); assert.equal(r.extra.engineS, 3600); assert.equal(r.extra.backupV, 4.12); assert.equal(r.extra.temp0.c, 22.5);
  } finally { await t.done(); }
});


// ---------------------------------------------------------------------------------------------------------------
// Orden de llegada: lo que motivó separar "guardar y confirmar" de "procesar viajes"
const first150 = () => trip().slice(0, 150); // origen (parada de 60 s) + salida: arranca el viaje
const expectTripStarted = async (t) => {
  assert.equal((await q(t.db, `select status from fleet_trips`))[0].status, "en_curso");
  const st = await q(t.db, `select status, arrived_at is not null a, departed_at is not null d from fleet_trip_stops where idx = 0`);
  assert.equal(st.length, 1); assert.equal(st[0].status, "ok"); assert.ok(st[0].a && st[0].d);
  const ev = await q(t.db, `select kind from geofence_events where geofence_id = $1 order by at, id`, [t.gids[0]]);
  assert.deepEqual(ev.map((e) => e.kind), ["entra", "sale"], "una entrada y una salida del origen, sin repetidos");
};

test("reportes que llegan desordenados dentro de la demora: el motor los acomoda y el viaje sale igual que en orden", async () => {
  const t = await boot({ env: { LAG_MS: "1500" } });
  try {
    const dev = await t.device();
    const ps = first150();
    const shuffled = ps.map((p, i) => [Math.floor(i / 25) * 25 + ((i * 7) % 25), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); // mezclado dentro de bloques de 25
    assert.notDeepEqual(shuffled.map((p) => p.t), ps.map((p) => p.t));
    const res = await dev.sendAll(shuffled);
    assert.ok(res.every((r) => r.acked));
    await t.server.settle();
    assert.equal(t.server.stats.replays, 0, "alcanzó con la demora: no hizo falta rehacer nada");
    await expectTripStarted(t);
  } finally { await t.done(); }
});

test("llegan posiciones MÁS VIEJAS que lo ya procesado (memoria del equipo): se rehace el viaje desde el historial y queda correcto", async () => {
  const t = await boot();
  try {
    const dev = await t.device();
    const ps = first150();
    await dev.sendAll(ps.slice(75));          // primero llega lo nuevo (después de la salida del origen)...
    await t.server.settle();
    assert.equal((await q(t.db, `select count(*)::int n from fleet_trip_stops where idx = 0`))[0].n, 0, "todavía no se sabe nada del origen");
    await dev.sendAll(ps.slice(0, 75));       // ...y después vuelca lo viejo
    await t.server.settle();
    assert.ok(t.server.stats.replays >= 1, "se rehízo desde el historial");
    await expectTripStarted(t);
    assert.equal((await q(t.db, `select count(*)::int n from gps_positions`))[0].n, ps.length);
    assert.equal((await q(t.db, `select count(*)::int n from fleet_alerts`))[0].n, 0, "y no inventó alertas");
  } finally { await t.done(); }
});

test("memoria del equipo volcada de la más nueva a la más vieja: el resultado final es el mismo que si hubiera llegado en orden", async () => {
  const ps = trip().slice(0, 650); // origen, salida y la primera parada intermedia
  const snapshot = async (t) => ({
    trip: await q(t.db, `select status, last_stop_idx from fleet_trips`), stops: await q(t.db, `select idx, status from fleet_trip_stops order by idx`),
    events: (await q(t.db, `select count(*)::int n from geofence_events`))[0].n, alerts: (await q(t.db, `select count(*)::int n from fleet_alerts`))[0].n,
  });
  const t = await boot();
  let reversed, replays;
  try {
    const dev = await t.device();
    for (let i = ps.length; i > 0; i -= 50) { await dev.sendAll(ps.slice(Math.max(0, i - 50), i)); await t.server.settle(); }
    reversed = await snapshot(t); replays = t.server.stats.replays;
  } finally { await t.done(); }
  assert.ok(replays >= 1, "se rehízo desde el historial");
  const u = await boot(); // otra vez desde cero, ahora en orden
  try {
    const dev = await u.device(); await dev.sendAll(ps); await u.server.settle();
    assert.deepEqual(reversed, await snapshot(u));
    assert.equal(reversed.trip[0].status, "en_curso"); assert.ok(reversed.stops.length >= 2);
  } finally { await u.done(); }
});

test("falla el guardado de viajes y alertas (los reportes ya estaban guardados y confirmados): se reintenta solo y no se pierde nada", async () => {
  const hooks = { failSave: 0 };
  const t = await boot({ hooks, env: { LAG_MS: "3600000" } }); // el motor solo procesa cuando se lo pedimos (settle)
  try {
    const dev = await t.device();
    const ps = first150();
    await dev.sendAll(ps);                                   // reportes guardados y confirmados
    // a partir de ahora, fallan los próximos 2 guardados (los del motor)
    hooks.failSave = 2;
    await t.server.settle();
    assert.ok(t.server.stats.engineErrors >= 1, "el motor falló al guardar");
    assert.equal(dev.lost, 0);
    await expectTripStarted(t);
  } finally { await t.done(); }
});

test("el servidor se cae sin avisar con reportes todavía sin procesar: al volver, los retoma desde lo guardado", async () => {
  const hooks = {};
  const t = await boot({ hooks, env: { LAG_MS: "3600000" } }); // el motor no llega a procesar nada antes de la caída
  try {
    const dev = await t.device();
    await dev.sendAll(first150());
    assert.equal((await q(t.db, `select count(*)::int n from gps_positions`))[0].n, 150, "los reportes ya estaban guardados");
    assert.equal((await q(t.db, `select status from fleet_trips`))[0].status, "programado", "pero el viaje todavía no se había armado");
    await t.server.stop({ graceful: false });               // caída abrupta: sin procesar lo pendiente
    const again = createServer({ store: pgStore(t.db), env: { UDP_PORT: "0", TCP_PORT: "0", HEALTH_PORT: "off", FLUSH_MS: "20", LAG_MS: "0", DRAIN_MS: "20", CONFIG_REFRESH_S: "3600", SWEEP_S: "3600" }, log: quiet });
    await again.start();
    await again.settle();
    await expectTripStarted(t);
    await again.stop();
  } finally { await t.done(); }
});
