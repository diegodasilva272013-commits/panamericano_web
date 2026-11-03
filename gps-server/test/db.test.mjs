// Pruebas de supabase/flota.sql contra Postgres real (en memoria): estructura, permisos, idempotencia y escritura por lotes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { freshDb, as, rpc } from "./helpers.mjs";

const ADMIN = "11111111-1111-1111-1111-111111111111", OTHER = "22222222-2222-2222-2222-222222222222";
const q = (db, sql, args = []) => db.query(sql, args).then((r) => r.rows);

async function setup() {
  const db = await freshDb();
  await db.exec(`insert into auth.users(id, email) values ('${ADMIN}', 'admin@x.com'), ('${OTHER}', 'otro@x.com'); insert into admins(user_id, email) values ('${ADMIN}', 'admin@x.com');`);
  const [v] = await q(db, `insert into vehicles(code, device_id) values ('INT 110', '860012345678901') returning id`);
  return { db, vid: v.id, svc: rpc(db, "service_role"), admin: rpc(db, "authenticated", ADMIN), other: rpc(db, "authenticated", OTHER) };
}
const pos = (vid, t, over = {}) => ({ vehicleId: vid, deviceId: "860012345678901", t, reportId: "28", lat: -24.18, lng: -65.3, speed: 40, course: 90, ign: true, voltage: 12.5, odometerM: 1000, sats: 9, csq: 18, ...over });

test("flota.sql se puede volver a ejecutar sin romper nada", async () => {
  const { db, vid } = await setup();
  const sql = fs.readFileSync(fileURLToPath(new URL("../../supabase/flota.sql", import.meta.url)), "utf8");
  await db.exec(sql); await db.exec(sql);
  assert.equal((await q(db, `select count(*)::int n from vehicles where id = $1`, [vid]))[0].n, 1);
  assert.equal((await q(db, `select count(*)::int n from fleet_settings`))[0].n, 1);
});

test("ajustes por defecto: límite de velocidad general 90 km/h", async () => {
  const { svc } = await setup();
  const cfg = await svc("gps_config");
  assert.equal(cfg.settings.speedLimit, 90);
  assert.equal(cfg.vehicles.length, 1);
  assert.equal(cfg.vehicles[0].deviceId, "860012345678901");
});

test("el servidor guarda un lote y un reporte repetido no se duplica (el equipo reintenta si no recibe el ACK)", async () => {
  const { db, vid, svc } = await setup();
  const batch = { positions: [pos(vid, "2026-04-06T15:30:25Z"), pos(vid, "2026-04-06T15:30:35Z", { speed: 55 })], state: [{ ...pos(vid, "2026-04-06T15:30:35Z", { speed: 55 }), inside: [], engine: { a: 1 } }] };
  assert.equal((await svc("gps_save", { p: batch })).positions, 2);
  assert.equal((await svc("gps_save", { p: batch })).positions, 0, "segunda vez: nada nuevo");
  assert.equal((await q(db, `select count(*)::int n from gps_positions`))[0].n, 2);
  const [s] = await q(db, `select speed, engine from vehicle_state where vehicle_id = $1`, [vid]);
  assert.equal(s.speed, 55); assert.deepEqual(s.engine, { a: 1 });
});

test("una posición vieja que llega tarde (memoria del equipo) se guarda pero no pisa el estado actual", async () => {
  const { db, vid, svc } = await setup();
  await svc("gps_save", { p: { positions: [pos(vid, "2026-04-06T16:00:00Z", { speed: 70 })], state: [{ ...pos(vid, "2026-04-06T16:00:00Z", { speed: 70 }) }] } });
  await svc("gps_save", { p: { positions: [pos(vid, "2026-04-06T15:00:00Z", { speed: 10 })], state: [{ ...pos(vid, "2026-04-06T15:00:00Z", { speed: 10 }) }] } });
  assert.equal((await q(db, `select count(*)::int n from gps_positions`))[0].n, 2, "la vieja queda en el historial");
  assert.equal((await q(db, `select speed from vehicle_state`))[0].speed, 70, "el estado sigue siendo el más nuevo");
});

test("un lote con un dato inválido no deja nada a medias", async () => {
  const { db, vid, svc } = await setup();
  await assert.rejects(() => svc("gps_save", { p: { positions: [pos(vid, "2026-04-06T15:30:25Z"), pos(vid, "no-es-fecha")] } }));
  assert.equal((await q(db, `select count(*)::int n from gps_positions`))[0].n, 0);
});

test("alertas: un episodio se crea una vez, se actualiza y conserva lo que el personal marcó como atendido", async () => {
  const { db, vid, svc, admin } = await setup();
  const al = (over = {}) => ({ vehicleId: vid, key: "vel:1", kind: "exceso_velocidad", severity: "aviso", title: "Exceso de velocidad", detail: "95 km/h", at: "2026-04-06T15:30:25Z", data: { max: 95 }, ...over });
  await svc("gps_save", { p: { alerts: [al()] } });
  const [a] = await q(db, `select id from fleet_alerts`);
  await admin("fleet_ack_alert", { p_id: a.id });
  await svc("gps_save", { p: { alerts: [al({ detail: "104 km/h", data: { max: 104 }, endedAt: "2026-04-06T15:33:00Z" })] } });
  const rows = await q(db, `select detail, data, ack_at, ended_at from fleet_alerts`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail, "104 km/h"); assert.equal(rows[0].data.max, 104);
  assert.ok(rows[0].ack_at, "el 'atendida' se conserva"); assert.ok(rows[0].ended_at);
});

test("viajes y paradas: se registran llegada, salida y atraso", async () => {
  const { db, vid, svc } = await setup();
  const [g] = await q(db, `insert into geofences(name, kind, shape, lat, lng, radius_m) values ('Terminal Jujuy', 'terminal', 'circle', -24.18, -65.3, 150) returning id`);
  const [t] = await q(db, `insert into fleet_trips(route_id, trip_date, trip_time, vehicle_id) values ('jj-lq', '2026-04-06', '06:15', $1) returning id`, [vid]);
  await svc("gps_save", { p: { trips: [{ id: t.id, status: "en_curso", startedAt: "2026-04-06T09:20:00Z", lastStopIdx: 0 }], stops: [{ tripId: t.id, idx: 0, geofenceId: g.id, name: "Terminal Jujuy", arrivedAt: "2026-04-06T09:00:00Z", departedAt: "2026-04-06T09:20:00Z", delayMin: 5, status: "ok" }],
    events: [{ vehicleId: vid, geofenceId: g.id, kind: "sale", at: "2026-04-06T09:20:00Z", lat: -24.18, lng: -65.3, speed: 20, tripId: t.id }] } });
  assert.equal((await q(db, `select status from fleet_trips`))[0].status, "en_curso");
  assert.equal((await q(db, `select delay_min from fleet_trip_stops`))[0].delay_min, 5);
  assert.equal((await q(db, `select count(*)::int n from geofence_events`))[0].n, 1);
});

test("permisos: la web pública y los no administradores no ven nada; solo el servidor escribe posiciones", async () => {
  const { db, vid, svc, admin, other } = await setup();
  await svc("gps_save", { p: { positions: [pos(vid, "2026-04-06T15:30:25Z")], state: [pos(vid, "2026-04-06T15:30:25Z")] } });
  const count = (role, sub, table) => as(db, role, async () => { try { return (await db.query(`select count(*)::int n from ${table}`)).rows[0].n; } catch (e) { return /permission denied/.test(e.message) ? "denegado" : e.message; } }, sub);
  for (const t of ["gps_positions", "vehicle_state", "vehicles", "geofences", "fleet_alerts", "fleet_trips"]) {
    assert.equal(await count("anon", "", t), "denegado", `anon no ve ${t}`);
    assert.equal(await count("authenticated", OTHER, t), 0, `un usuario sin permiso de administrador ve 0 filas de ${t}`);
  }
  assert.equal(await count("authenticated", ADMIN, "gps_positions"), 1);
  for (const [name, role, sub] of [["gps_save", "anon", ""], ["gps_save", "authenticated", ADMIN], ["gps_config", "anon", ""], ["gps_config", "authenticated", ADMIN], ["gps_purge", "authenticated", ADMIN]]) {
    await assert.rejects(() => rpc(db, role, sub)(name, name === "gps_save" ? { p: {} } : name === "gps_purge" ? {} : {}), /permission denied/, `${role} no puede ejecutar ${name}`);
  }
  // el personal no puede escribir posiciones a mano ni atender alertas de otro modo que con la función
  await assert.rejects(() => as(db, "authenticated", () => db.query(`insert into gps_positions(vehicle_id, device_id, event_time, lat, lng) values ($1, 'x', now(), 0, 0)`, [vid]), ADMIN), /permission denied/);
  await assert.rejects(() => other("fleet_ack_alert", { p_id: "00000000-0000-0000-0000-000000000000" }), /SIN_PERMISO/);
  assert.ok(admin);
});

test("el ERP (administrador) maneja vehículos y geocercas; los datos inválidos se rechazan", async () => {
  const { db } = await setup();
  const ins = (sql, args = []) => as(db, "authenticated", () => db.query(sql, args), ADMIN);
  await ins(`insert into vehicles(code, plate) values ('INT 111', 'AB123CD')`);
  await assert.rejects(() => ins(`insert into vehicles(code) values ('INT 111')`), /unique|duplicate/);
  await ins(`insert into geofences(name, kind, shape, lat, lng, radius_m) values ('Parada', 'parada', 'circle', -24, -65, 100)`);
  await assert.rejects(() => ins(`insert into geofences(name, shape, lat, lng, radius_m) values ('Mala', 'circle', 200, -65, 100)`), /geofences_forma/);
  await assert.rejects(() => ins(`insert into geofences(name, shape, polygon) values ('Poli', 'polygon', '[[1,1],[2,2]]'::jsonb)`), /geofences_forma/);
  await ins(`insert into geofences(name, kind, shape, polygon, speed_limit) values ('Zona 60', 'zona', 'polygon', '[[-24,-65],[-24.1,-65],[-24.1,-65.1]]'::jsonb, 60)`);
});

test("gps_purge borra solo el detalle viejo y respeta un mínimo de 7 días", async () => {
  const { db, vid, svc } = await setup();
  const old = new Date(Date.now() - 40 * 864e5).toISOString(), recent = new Date(Date.now() - 2 * 864e5).toISOString();
  await svc("gps_save", { p: { positions: [pos(vid, old), pos(vid, recent)] } });
  assert.equal(Number(await svc("gps_purge", { p_days: 1 })), 1, "con 1 día pedido se aplica el mínimo de 7: solo cae la de 40 días");
  assert.equal((await q(db, `select count(*)::int n from gps_positions`))[0].n, 1);
});

test("equipos desconocidos: quedan registrados para vincularlos desde el ERP", async () => {
  const { db, svc } = await setup();
  await svc("gps_unknown", { p: [{ deviceId: "999", sample: ">RCQ...", frames: 3 }] });
  await svc("gps_unknown", { p: [{ deviceId: "999", sample: ">RCQ2", frames: 2 }] });
  const [r] = await q(db, `select frames::int f from gps_unknown_devices where device_id = '999'`);
  assert.equal(r.f, 5);
});

test("un lote con la misma parada, alerta o estado repetidos no falla: gana la última versión", async () => {
  const { db, vid, svc } = await setup();
  const [g] = await q(db, `insert into geofences(name, kind, shape, lat, lng, radius_m) values ('T', 'terminal', 'circle', -24, -65, 100) returning id`);
  const [t] = await q(db, `insert into fleet_trips(route_id, trip_date, trip_time, vehicle_id) values ('r', '2026-04-06', '06:15', $1) returning id`, [vid]);
  const a = (detail) => ({ vehicleId: vid, key: "vel:1", kind: "exceso_velocidad", title: "Exceso", detail, at: "2026-04-06T15:30:25Z" });
  await svc("gps_save", { p: {
    stops: [{ tripId: t.id, idx: 1, geofenceId: g.id, name: "T", arrivedAt: "2026-04-06T09:00:00Z", status: "pendiente" }, { tripId: t.id, idx: 1, geofenceId: g.id, name: "T", arrivedAt: "2026-04-06T09:00:00Z", departedAt: "2026-04-06T09:02:00Z", dwellS: 120, status: "ok" }],
    alerts: [a("91 km/h"), a("97 km/h"), a("104 km/h")],
    state: [pos(vid, "2026-04-06T15:00:00Z", { speed: 10 }), pos(vid, "2026-04-06T15:10:00Z", { speed: 30 })],
  } });
  assert.equal((await q(db, `select status, dwell_s from fleet_trip_stops`))[0].status, "ok");
  assert.equal((await q(db, `select detail from fleet_alerts`))[0].detail, "104 km/h");
  assert.equal((await q(db, `select speed from vehicle_state`))[0].speed, 30);
});

test("reporte de distancias diarias: kilómetros, tiempos y velocidades por coche y por día de Jujuy; no cuenta los huecos sin señal; solo administradores", async () => {
  const { db, vid, svc, admin, other } = await setup();
  // día 1 (Jujuy): 60 posiciones cada 10 s a 72 km/h hacia el norte (200 m por paso), 20 detenido con motor, y un hueco de 20 min sin señal
  const t0 = Date.parse("2026-04-06T12:00:00Z"); // 09:00 en Jujuy
  const P = [];
  let lat = -24, k = 0;
  for (let i = 0; i < 60; i++) { P.push(pos(vid, new Date(t0 + k * 10_000).toISOString(), { lat, lng: -65, speed: 72 })); lat += 200 / 111195; k++; }
  for (let i = 0; i < 20; i++) { P.push(pos(vid, new Date(t0 + k * 10_000).toISOString(), { lat, lng: -65, speed: 0, ign: true })); k++; }
  k += 120; // 20 minutos sin datos
  lat += 5000 / 111195; // y el coche reaparece 5 km más allá: eso NO se cuenta como recorrido
  for (let i = 0; i < 10; i++) { P.push(pos(vid, new Date(t0 + k * 10_000).toISOString(), { lat, lng: -65, speed: 36 })); lat += 100 / 111195; k++; }
  // día 2: solo dos posiciones
  P.push(pos(vid, "2026-04-07T13:00:00Z", { lat: -23, lng: -65, speed: 50 }), pos(vid, "2026-04-07T13:00:10Z", { lat: -23 + 100 / 111195, lng: -65, speed: 50 }));
  await svc("gps_save", { p: { positions: P } });
  const daily = (role, sub, from, to, veh = null) => as(db, role, async () => (await db.query(`select * from fleet_daily($1::date, $2::date, $3::uuid[])`, [from, to, veh])).rows, sub);
  const rows = await daily("authenticated", ADMIN, "2026-04-06", "2026-04-07");
  assert.equal(rows.length, 2);
  const [d1, d2] = rows;
  const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d)); // el simulador devuelve un Date; PostgREST, un texto
  assert.equal(ymd(d1.day), "2026-04-06"); assert.equal(d1.code, "INT 110");
  assert.ok(Math.abs(Number(d1.km) - (59 * 0.2 + 9 * 0.1)) < 0.6, `km día 1: ${d1.km}`);
  assert.ok(Number(d1.km) < 15, "el salto de 5 km después del hueco no se suma");
  assert.ok(Math.abs(Number(d1.moving_min) - 10) <= 2, `en marcha: ${d1.moving_min} min`);
  assert.ok(Math.abs(Number(d1.idle_min) - 3) <= 2, `detenido con motor: ${d1.idle_min} min`);
  assert.equal(d1.max_speed, 72); assert.equal(d1.positions, 90);
  assert.equal(ymd(d2.day), "2026-04-07"); assert.equal(d2.positions, 2);
  assert.deepEqual(await daily("authenticated", ADMIN, "2026-04-06", "2026-04-06", ["00000000-0000-0000-0000-000000000000"]), []);
  assert.deepEqual(await daily("authenticated", OTHER, "2026-04-06", "2026-04-07"), [], "un usuario sin permiso de administrador no ve nada");
  await assert.rejects(() => daily("anon", "", "2026-04-06", "2026-04-07"), /permission denied/);
  assert.ok(admin && other);
});

test("reconstrucción: borra lo derivado en la ventana (eventos, alertas sin atender, paradas) y deja el viaje listo para recalcularse; conserva lo ya atendido y lo anterior", async () => {
  const { db, vid, svc, admin } = await setup();
  const [g] = await q(db, `insert into geofences(name, kind, shape, lat, lng, radius_m) values ('T', 'terminal', 'circle', -24, -65, 100) returning id`);
  const [t] = await q(db, `insert into fleet_trips(route_id, trip_date, trip_time, vehicle_id, status) values ('r', '2026-04-06', '06:15', $1, 'en_curso') returning id`, [vid]);
  const al = (key, at, kind = "parada_omitida") => ({ vehicleId: vid, key, kind, title: kind, at });
  await svc("gps_save", { p: { alerts: [al("viejo", "2026-04-06T08:00:00Z"), al("nuevo1", "2026-04-06T10:00:00Z"), al("nuevo2", "2026-04-06T10:05:00Z"), al("atendida", "2026-04-06T10:10:00Z"), al("sin", "2026-04-06T10:20:00Z", "sin_senal")],
    events: [{ vehicleId: vid, geofenceId: g.id, kind: "entra", at: "2026-04-06T08:00:00Z" }, { vehicleId: vid, geofenceId: g.id, kind: "entra", at: "2026-04-06T10:00:00Z" }],
    stops: [{ tripId: t.id, idx: 0, geofenceId: g.id, name: "T", arrivedAt: "2026-04-06T10:00:00Z", status: "ok" }], trips: [{ id: t.id, status: "en_curso", startedAt: "2026-04-06T10:01:00Z", distanceM: 5000 }] } });
  const [a] = await q(db, `select id from fleet_alerts where key = 'atendida'`);
  await admin("fleet_ack_alert", { p_id: a.id });
  await svc("gps_save", { p: { rebuild: [{ vehicleId: vid, from: "2026-04-06T09:00:00Z", tripIds: [t.id] }] } });
  assert.deepEqual((await q(db, `select key from fleet_alerts order by key`)).map((r) => r.key), ["atendida", "sin", "viejo"], "quedan: lo anterior a la ventana, lo ya atendido y la falta de señal");
  assert.equal((await q(db, `select count(*)::int n from geofence_events`))[0].n, 1, "el evento anterior a la ventana se conserva");
  assert.equal((await q(db, `select count(*)::int n from fleet_trip_stops`))[0].n, 0);
  const [tr] = await q(db, `select status, started_at, distance_m from fleet_trips`);
  assert.equal(tr.status, "programado"); assert.equal(tr.started_at, null); assert.equal(tr.distance_m, null);
  // y después se vuelve a cargar lo recalculado
  await svc("gps_save", { p: { trips: [{ id: t.id, status: "en_curso", startedAt: "2026-04-06T10:01:00Z" }], stops: [{ tripId: t.id, idx: 0, geofenceId: g.id, name: "T", arrivedAt: "2026-04-06T10:00:00Z", status: "ok" }] } });
  assert.equal((await q(db, `select status from fleet_trips`))[0].status, "en_curso");
});

test("un administrador puede sacar un equipo de la lista de nuevos (al vincularlo); otros usuarios no", async () => {
  const { db, svc } = await setup();
  await svc("gps_unknown", { p: [{ deviceId: "777", sample: ">RCQ", frames: 1 }] });
  const del = (sub) => as(db, "authenticated", async () => (await db.query(`delete from gps_unknown_devices where device_id = '777' returning 1`)).rowCount, sub);
  assert.equal(await del(OTHER), 0, "sin permiso de administrador no borra nada");
  assert.equal(await del(ADMIN), 1);
});
