// "En vivo" para pasajeros: el cálculo (dónde va, paradas, horarios estimados) y lo que la base deja ver al público.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoute, tripView, displayAlong, profileFor, fmtIn } from "../../src/envivo/model.js";
import { cumulative } from "../geo.js";
import { freshDb, as, rpc } from "./helpers.mjs";
import { simulate } from "../../src/envivo/sim.js";

// una recta norte-sur de ~40 km con 3 paradas
const LINE = [[-24.0, -65.3], [-23.8, -65.3], [-23.64, -65.3]];
const cum = cumulative(LINE), L = cum.at(-1);
const at = (along) => { const t = along / L; return [LINE[0][0] + (LINE[2][0] - LINE[0][0]) * t, -65.3]; };
const RAW = { route_id: "jj-lq", polyline: LINE, stops: [
  { idx: 0, name: "San Salvador de Jujuy", offset_min: 0, lat: LINE[0][0], lng: -65.3 },
  { idx: 1, name: "Purmamarca", offset_min: 30, lat: at(L / 2)[0], lng: -65.3 },
  { idx: 2, name: "Tilcara", offset_min: 50, lat: LINE[2][0], lng: -65.3 },
] };
const CONTENT = {
  routes: [{ id: "jj-lq", from: "San Salvador de Jujuy", to: "La Quiaca*", via: "Ruta 9" }],
  journey: [{ name: "San Salvador de Jujuy", short: "Jujuy", alt: 1260, km: 0 }, { name: "Volcán", alt: 1700, km: 28 }, { name: "Purmamarca", alt: 2324, km: 65 }, { name: "Tilcara", alt: 2461, km: 86 }],
};
const NOW = Date.parse("2026-11-04T12:00:00Z");
const iso = (t) => new Date(t).toISOString();

test("la ruta toma el nombre de la web, proyecta las paradas y arma el perfil con los pueblos de la Ruta 9", () => {
  const r = buildRoute(RAW, CONTENT);
  assert.equal(r.name, "Jujuy → La Quiaca");
  assert.deepEqual(r.stops.map((s) => Math.round(s.along / 1000)), [0, Math.round(L / 2000), Math.round(L / 1000)]);
  assert.ok(r.profile.known);
  assert.equal(Math.round(r.profile.alt(0)), 1260);
  assert.equal(Math.round(r.profile.alt(r.stops[2].along)), 2461);
  // Volcán no es parada pero entra al perfil por su kilómetro: a mitad de camino a Purmamarca ya subió
  const mid = r.profile.alt(r.stops[1].along * 0.43);
  assert.ok(mid > 1500 && mid < 2000, `altura intermedia ${mid}`);
});

test("sin pueblos con altura conocida el camino queda plano (no se inventa)", () => {
  const p = profileFor([{ name: "Iruya", along: 0 }, { name: "Otro", along: 9000 }], CONTENT.journey);
  assert.equal(p.known, false);
  assert.equal(p.alt(4000), 0);
});

test("viaje en curso: paradas hechas, próxima parada y horario estimado por lo que falta de cada tramo", () => {
  const r = buildRoute(RAW, CONTENT);
  const pos = at(L * 0.75);
  const v = tripView(r, { id: "t", route_id: "jj-lq", trip_time: "08:30", status: "en_curso", planned_at: iso(NOW - 40 * 60_000), coach: "INT 125",
    pos: { lat: pos[0], lng: pos[1], moving: true, at: iso(NOW - 5000) },
    stops: [{ idx: 0, status: "ok", departed_at: iso(NOW - 38 * 60_000) }, { idx: 1, status: "ok", arrived_at: iso(NOW - 10 * 60_000), departed_at: iso(NOW - 9 * 60_000) }] }, NOW);
  assert.equal(v.freshness, "live");
  assert.equal(v.passed, 1);
  assert.equal(v.next, 2);
  assert.equal(v.where, "Entre Purmamarca y Tilcara");
  // el tramo Purmamarca-Tilcara está previsto en 20 min; falta la mitad: unos 10 minutos (desde la última señal)
  const eta = v.etas.get(2);
  assert.equal(eta.kind, "estimado");
  assert.ok(Math.abs((eta.at - NOW) / 60_000 - 10) < 1, `faltan ${(eta.at - NOW) / 60_000} min`);
  assert.equal(v.etas.get(1).kind, "hecho");
  assert.equal(fmtIn(eta.at, NOW), "10 min");
});

test("entre señal y señal el coche avanza al ritmo del tramo, pero no pasa la próxima parada ni más de 90 s", () => {
  const r = buildRoute(RAW, CONTENT), p = at(L * 0.48);
  const v = tripView(r, { id: "t", status: "en_curso", trip_time: "08:30", pos: { lat: p[0], lng: p[1], moving: true, at: iso(NOW) }, stops: [{ idx: 0, status: "ok" }] }, NOW);
  const a1 = displayAlong(v, NOW + 10_000);
  assert.ok(a1 > v.along, "avanza");
  assert.ok(displayAlong(v, NOW + 3600_000) <= r.stops[1].along - 39, "espera antes de la parada");
  const still = tripView(r, { id: "t", status: "en_curso", trip_time: "08:30", pos: { lat: p[0], lng: p[1], moving: false, at: iso(NOW) }, stops: [] }, NOW);
  assert.equal(displayAlong(still, NOW + 30_000), still.along, "detenido no se mueve");
});

test("sin señal hace más de 10 minutos: se avisa y los horarios salen del programado más el último atraso", () => {
  const r = buildRoute(RAW, CONTENT), p = at(L * 0.2);
  const planned = NOW - 30 * 60_000;
  const v = tripView(r, { id: "t", status: "en_curso", trip_time: "08:30", planned_at: iso(planned), pos: { lat: p[0], lng: p[1], moving: true, at: iso(NOW - 15 * 60_000) },
    stops: [{ idx: 0, status: "ok", departed_at: iso(planned + 4 * 60_000), delay_min: 4 }] }, NOW);
  assert.equal(v.freshness, "lost");
  assert.equal(v.moving, false);
  assert.equal(v.etas.get(1).kind, "horario");
  assert.equal(v.etas.get(1).at, planned + (30 + 4) * 60_000);
});

test("viaje programado: muestra la salida y el horario de cada parada", () => {
  const r = buildRoute(RAW, CONTENT), planned = NOW + 60 * 60_000;
  const v = tripView(r, { id: "t", status: "programado", trip_time: "13:00", planned_at: iso(planned), stops: [] }, NOW);
  assert.equal(v.where, "Sale a las 13:00 de Jujuy");
  assert.equal(v.etas.get(2).at, planned + 50 * 60_000);
});

test("la base: el público lee recorridos y viajes en curso por las dos funciones, sin patente ni IMEI, y no puede leer las tablas", async () => {
  const db = await freshDb();
  const g = async (name, lat) => (await db.query(`insert into geofences(name, kind, shape, lat, lng, radius_m) values ($1, 'parada', 'circle', $2, -65.3, 150) returning id`, [name, lat])).rows[0].id;
  const g0 = await g("San Salvador de Jujuy", LINE[0][0]), g1 = await g("Tilcara", LINE[2][0]);
  await db.query(`insert into fleet_routes(route_id, polyline) values ('jj-lq', $1)`, [JSON.stringify(LINE)]);
  await db.query(`insert into fleet_route_stops(route_id, idx, geofence_id, name, offset_min) values ('jj-lq', 0, $1, 'San Salvador de Jujuy', 0), ('jj-lq', 1, $2, 'Tilcara', 50)`, [g0, g1]);
  const v = (await db.query(`insert into vehicles(code, plate, device_id) values ('INT 125', 'AB123CD', '860000000000125') returning id`)).rows[0].id;
  const parked = (await db.query(`insert into vehicles(code, plate, device_id) values ('INT 130', 'ZZ999ZZ', '860000000000130') returning id`)).rows[0].id;
  await db.query(`insert into vehicle_state(vehicle_id, last_time, lat, lng, speed, course) values ($1, now() - interval '20 seconds', -23.9, -65.3, 78, 0), ($2, now(), -24.1, -65.2, 0, 0)`, [v, parked]);
  const t = (await db.query(`insert into fleet_trips(route_id, trip_date, trip_time, vehicle_id, status, planned_at, started_at) values ('jj-lq', current_date, '08:30', $1, 'en_curso', now() - interval '30 minutes', now() - interval '28 minutes') returning id`, [v])).rows[0].id;
  await db.query(`insert into fleet_trip_stops(trip_id, idx, name, status, departed_at, delay_min) values ($1, 0, 'San Salvador de Jujuy', 'ok', now() - interval '28 minutes', 2)`, [t]);
  await db.query(`insert into fleet_trips(route_id, trip_date, trip_time, vehicle_id, status, planned_at) values ('jj-lq', current_date, '23:59', $1, 'programado', now() + interval '10 hours')`, [parked]);

  const call = rpc(db, "anon");
  const routes = await call("public_routes");
  assert.equal(routes.length, 1);
  assert.equal(routes[0].stops[1].name, "Tilcara");
  assert.equal(routes[0].stops[1].lat, LINE[2][0]);
  const live = await call("public_live");
  assert.equal(live.trips.length, 1, "solo el viaje en curso (el programado para dentro de 10 h no sale)");
  const trip = live.trips[0];
  assert.equal(trip.coach, "INT 125");
  assert.equal(trip.pos.moving, true);
  assert.equal(trip.stops[0].delay_min, 2);
  const text = JSON.stringify(live);
  for (const secret of ["AB123CD", "860000000000125", "ZZ999ZZ", "\"speed\""]) assert.ok(!text.includes(secret), `no expone ${secret}`);
  // las tablas siguen cerradas al público
  for (const tbl of ["vehicles", "vehicle_state", "fleet_trips", "gps_positions"]) await assert.rejects(as(db, "anon", () => db.query(`select * from ${tbl}`)), /permission denied/, tbl);
});

test("simulación: con el horario real, los coches en viaje están sobre su ruta y avanzan parada por parada", () => {
  const routes = [{ id: "jj-lq", from: "San Salvador de Jujuy", to: "La Quiaca*", stops: ["Purmamarca", "Tilcara", "Humahuaca", "Abra Pampa", "La Quiaca"], times: ["06:00", "09:00"] },
    { id: "jj-iru", from: "San Salvador de Jujuy", to: "Iruya", stops: ["Humahuaca", "Iruya"], times: ["06:00"] }];
  const now = Date.parse("2026-11-04T08:00:00-03:00");
  const { routes: rs, live } = simulate(routes, now);
  assert.deepEqual(rs.map((r) => r.route_id), ["jj-lq"], "solo rutas por la Ruta 9 (Iruya no está en la troncal)");
  const r = buildRoute(rs[0], CONTENT);
  const running = live.trips.filter((t) => t.status === "en_curso"), soon = live.trips.filter((t) => t.status === "programado");
  assert.equal(running.length, 1); assert.equal(soon.length, 1, "la de las 09:00 sale en menos de 3 h");
  const v = tripView(r, running[0], now);
  assert.equal(v.freshness, "live");
  assert.ok(v.along > 0 && v.along < r.length);
  assert.ok(v.passed >= 1, "a las 2 h de salir ya pasó Purmamarca");
  // una hora después va más adelante
  const later = simulate(routes, now + 3600_000).live.trips.find((t) => t.id === running[0].id);
  assert.ok(tripView(r, later, now + 3600_000).along > v.along);
});
