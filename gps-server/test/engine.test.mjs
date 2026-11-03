// Pruebas del motor de eventos con recorridos simulados sobre una ruta de ~130 km con 4 paradas.
import test from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../engine.js";
import { cumulative, distance } from "../geo.js";
import { drive, pointAt, thin, TEST_LINE } from "../sim-route.js";

const CUM = cumulative(TEST_LINE), L = CUM.at(-1);
const ALONG = [0, Math.round(L * 0.3), Math.round(L * 0.65), Math.round(L)];
const NAMES = ["Terminal Jujuy", "Purmamarca", "Humahuaca", "La Quiaca"];
const PLANNED = Date.parse("2026-04-06T06:15:00-03:00");
const iso = (ms) => new Date(ms).toISOString();

function config({ offsets = [0, null, null, null], zones = [], trip = {}, settings = {}, mandatory = [true, true, true, true] } = {}) {
  const geofences = ALONG.map((a, i) => { const p = pointAt(TEST_LINE, CUM, a); return { id: `g${i}`, name: NAMES[i], kind: i === 0 || i === 3 ? "terminal" : "parada", shape: "circle", lat: p.lat, lng: p.lng, radiusM: 150 }; });
  return {
    settings: { speedLimit: 90, speedGraceS: 10, noSignalMin: 10, delayTolMin: 5, idleStopMin: 15, ...settings },
    vehicles: [{ id: "v1", code: "INT 110", deviceId: "860012345678901" }],
    geofences: [...geofences, ...zones],
    routes: [{ routeId: "r1", polyline: TEST_LINE, corridorM: 400, stops: ALONG.map((_, i) => ({ idx: i, geofenceId: `g${i}`, name: NAMES[i], offsetMin: offsets[i], mandatory: mandatory[i] })) }],
    trips: [{ id: "t1", routeId: "r1", date: "2026-04-06", time: "06:15", vehicleId: "v1", status: "programado", plannedAt: iso(PLANNED), ...trip }],
    states: [],
  };
}
const stopsFor = (opts = {}) => [1, 2].map((i) => ({ along: ALONG[i], dwellS: 60, stop: !(opts.skip || []).includes(i) }));

// pasa todas las posiciones por el motor y junta el resultado final (última versión de cada alerta / parada)
function run(cfg, positions, { engine = createEngine(), vid = "v1" } = {}) {
  engine.setConfig(cfg);
  const res = { alerts: new Map(), stops: new Map(), trips: [], events: [], late: 0, states: [], engine };
  for (const p of positions) {
    const { out, state } = engine.ingest(vid, p);
    if (out.late) { res.late++; continue; }
    for (const a of out.alerts) res.alerts.set(a.key, { ...(res.alerts.get(a.key) || {}), ...a });
    for (const s of out.stops) res.stops.set(s.idx, { ...(res.stops.get(s.idx) || {}), ...s });
    res.trips.push(...out.trips); res.events.push(...out.events); res.states.push(state);
  }
  res.kinds = [...res.alerts.values()].map((a) => a.kind);
  res.alertsOf = (k) => [...res.alerts.values()].filter((a) => a.kind === k);
  res.lastTrip = res.trips.at(-1);
  return res;
}
const trip = (opts = {}) => drive({ line: TEST_LINE, startMs: PLANNED, dwellAtStart: 60, stops: stopsFor(opts), ...opts });

test("el recorrido de prueba es consistente (largo de la ruta y posiciones)", () => {
  assert.ok(L > 100_000 && L < 250_000, `largo ${Math.round(L)} m`);
  const ps = trip();
  assert.ok(ps.length > 500);
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i].t > ps[i - 1].t);
  assert.ok(distance([ps[0].lat, ps[0].lng], [ps.at(-1).lat, ps.at(-1).lng]) > 100_000);
});

test("viaje perfecto: arranca al salir del origen, frena en todas las paradas, termina al llegar y no genera alertas", () => {
  const r = run(config(), trip());
  assert.deepEqual(r.kinds, [], "sin alertas");
  assert.equal(r.trips.find((t) => t.status === "en_curso")?.id, "t1");
  assert.equal(r.lastTrip.status, "completado");
  assert.equal(r.lastTrip.lastStopIdx, 3);
  for (let i = 0; i < 4; i++) assert.equal(r.stops.get(i).status, "ok", `parada ${i}`);
  for (const i of [1, 2]) { assert.ok(r.stops.get(i).dwellS >= 50, "tiempo detenido"); assert.ok(r.stops.get(i).arrivedAt < r.stops.get(i).departedAt); }
  assert.ok(r.lastTrip.distanceM > 100_000 && r.lastTrip.maxSpeed >= 70);
  // eventos de geocercas: entra y sale de cada parada intermedia, en orden
  const ev = r.events.filter((e) => e.geofenceId === "g1").map((e) => e.kind);
  assert.deepEqual(ev, ["entra", "sale"]);
  assert.equal(r.engine.state("v1").trip, null, "el viaje cerrado se libera");
});

test("no frena en una parada obligatoria: queda 'omitida' y se avisa", () => {
  const r = run(config(), trip({ skip: [2] }));
  assert.equal(r.stops.get(2).status, "omitida");
  const a = r.alertsOf("parada_omitida");
  assert.equal(a.length, 1); assert.match(a[0].title, /Humahuaca/);
  assert.equal(r.stops.get(1).status, "ok");
  assert.equal(r.lastTrip.status, "completado");
});

test("una parada no obligatoria no genera aviso si pasa de largo", () => {
  const r = run(config({ mandatory: [true, true, false, true] }), trip({ skip: [2] }));
  assert.deepEqual(r.alertsOf("parada_omitida"), []);
});

test("pasa de largo a alta velocidad con reportes espaciados: igual se detecta (no se pierde entre dos posiciones)", () => {
  const ps = thin(trip({ skip: [1], every: 7, cruise: 100 }), 6); // un reporte cada ~42 s a ~100 km/h = saltos de más de un kilómetro
  const r = run(config(), ps);
  assert.ok(r.events.some((e) => e.geofenceId === "g1" && e.kind === "entra"), "vio la entrada aunque ninguna posición cayó dentro");
  assert.equal(r.alertsOf("parada_omitida").length >= 1, true);
});

test("exceso de velocidad: un episodio, con el máximo y el cierre; un pico de un solo reporte no avisa", () => {
  const fast = (a) => (a > ALONG[1] * 0.4 && a < ALONG[1] * 0.4 + 6000 ? 112 : 75); // 6 km a 112 km/h
  const r = run(config(), trip({ cruise: fast }));
  const v = r.alertsOf("exceso_velocidad");
  assert.equal(v.length, 1, "un solo episodio");
  assert.equal(v[0].data.maxSpeed, 112); assert.equal(v[0].severity, "critica", "20 km/h o más por encima del límite es crítica");
  assert.ok(v[0].endedAt, "se cierra al volver a velocidad normal");
  const spike = run(config(), trip({ cruise: (a) => (Math.abs(a - 20000) < 80 ? 95 : 75) }));
  assert.deepEqual(spike.alertsOf("exceso_velocidad"), [], "un pico breve no cuenta");
});

test("zona con límite propio: 70 km/h es exceso dentro de una zona de 60", () => {
  const p = pointAt(TEST_LINE, CUM, 30000);
  const zone = { id: "z60", name: "Tramo urbano", kind: "zona", shape: "circle", lat: p.lat, lng: p.lng, radiusM: 3000, speedLimit: 60 };
  const r = run(config({ zones: [zone] }), trip({ cruise: 70 }));
  const v = r.alertsOf("exceso_velocidad");
  assert.ok(v.length >= 1);
  assert.match(v[0].detail, /límite 60/);
  const sin = run(config(), trip({ cruise: 70 }));
  assert.deepEqual(sin.alertsOf("exceso_velocidad"), [], "con el límite general de 90 no hay exceso");
});

test("zona prohibida: entrar genera una alerta crítica", () => {
  const p = pointAt(TEST_LINE, CUM, 50000);
  const r = run(config({ zones: [{ id: "zr", name: "Tramo Cárcel prohibido", kind: "restringida", shape: "circle", lat: p.lat, lng: p.lng, radiusM: 500 }] }), trip());
  const a = r.alertsOf("geocerca_restringida");
  assert.equal(a.length, 1); assert.equal(a[0].severity, "critica");
});

test("sentido contrario: después de arrancar, vuelve por la ruta hacia atrás", () => {
  const ida = drive({ line: TEST_LINE, startMs: PLANNED, dwellAtStart: 60, stops: [], to: 20000 });
  const vuelta = drive({ line: TEST_LINE, startMs: ida.at(-1).t + 7000, from: L - 20000, to: L - 20000 + 12000 + 1, reverse: true });
  // la vuelta arranca donde terminó la ida y recorre la ruta hacia atrás
  const back = drive({ line: TEST_LINE, startMs: ida.at(-1).t + 7000, from: L - 20000, to: L - 5000, reverse: true });
  assert.ok(vuelta.length && back.length);
  const r = run(config(), [...ida, ...back]);
  const a = r.alertsOf("sentido_contrario");
  assert.equal(a.length, 1, "un aviso por episodio, no uno por reporte");
  assert.equal(a[0].severity, "critica");
});

test("el viaje normal nunca dispara 'sentido contrario'", () => {
  assert.deepEqual(run(config(), trip()).alertsOf("sentido_contrario"), []);
});

test("fuera de ruta: se aleja más del corredor por más de un minuto, avisa y cierra al volver", () => {
  const ps = trip();
  const k0 = ps.findIndex((p) => p.t > PLANNED + 20 * 60_000);
  const out = ps.map((p, i) => (i >= k0 && i < k0 + 20 ? { ...p, lat: p.lat + 0.03 } : p)); // ~3,3 km al costado durante 20 reportes (~2,3 min)
  const r = run(config(), out);
  const a = r.alertsOf("fuera_de_ruta");
  assert.equal(a.length, 1); assert.ok(a[0].endedAt);
});

test("atraso en la salida: sale 20 minutos tarde y avisa; sale en hora y no avisa", () => {
  const tarde = run(config(), drive({ line: TEST_LINE, startMs: PLANNED + 20 * 60_000, dwellAtStart: 60, stops: stopsFor() }));
  const a = tarde.alertsOf("atraso");
  assert.ok(a.some((x) => x.key.endsWith(":dep")), "atraso de salida");
  assert.ok(Math.abs(a.find((x) => x.key.endsWith(":dep")).data.delayMin - 21) <= 2);
  assert.deepEqual(run(config(), trip()).alertsOf("atraso"), []);
});

test("atraso en una parada con hora esperada (offsetMin): se mide y se avisa solo si pasa la tolerancia", () => {
  // referencia: cuándo llega un viaje perfecto a cada parada
  const ref = run(config(), trip());
  const off = [0, 1, 2, 3].map((i) => Math.round((Date.parse(ref.stops.get(i).arrivedAt) - PLANNED) / 60_000));
  const puntual = run(config({ offsets: off }), trip());
  assert.deepEqual(puntual.alertsOf("atraso"), []);
  assert.ok(Math.abs(puntual.stops.get(2).delayMin) <= 2);
  const demorado = run(config({ offsets: off }), drive({ line: TEST_LINE, startMs: PLANNED, dwellAtStart: 60, stops: [{ along: ALONG[1], dwellS: 20 * 60 }, { along: ALONG[2], dwellS: 60 }] }));
  const a = demorado.alertsOf("atraso");
  assert.ok(a.some((x) => x.data.stop === "Humahuaca"), "llegó tarde a Humahuaca por la demora anterior");
  assert.ok(demorado.stops.get(2).delayMin >= 15);
});

test("posiciones repetidas o fuera de orden (memoria del equipo) no mueven el estado ni duplican nada", () => {
  const ps = trip();
  const eng = createEngine();
  const half = ps.slice(0, 200);
  const a = run(config(), half, { engine: eng });
  const stopsBefore = JSON.stringify([...a.stops]);
  const b = run(config(), [...half.slice(50, 120), ...half.slice(0, 10)], { engine: eng });
  assert.equal(b.late, 80, "todas llegaron tarde");
  assert.equal(b.alerts.size, 0); assert.equal(JSON.stringify([...a.stops]), stopsBefore);
});

test("sin señal: avisa a los 10 min si el coche estaba en servicio, y lo cierra cuando vuelve a transmitir", () => {
  const eng = createEngine();
  const ps = trip().slice(0, 100);
  const r = run(config(), ps, { engine: eng });
  const last = ps.at(-1);
  assert.deepEqual(eng.sweep(last.t + 5 * 60_000).alerts, [], "a los 5 minutos todavía no");
  const o = eng.sweep(last.t + 11 * 60_000);
  assert.equal(o.alerts.length, 1); assert.equal(o.alerts[0].kind, "sin_senal");
  assert.deepEqual(eng.sweep(last.t + 15 * 60_000).alerts, [], "no repite el aviso");
  const back = eng.ingest("v1", { ...ps[100], t: last.t + 20 * 60_000, lat: last.lat, lng: last.lng });
  assert.equal(back.out.alerts.find((a) => a.kind === "sin_senal").endedAt != null, true);
  assert.ok(r);
});

test("un coche apagado y quieto no genera 'sin señal'", () => {
  const eng = createEngine(); eng.setConfig(config());
  eng.ingest("v1", { t: PLANNED, lat: -24.185, lng: -65.3, speed: 0, course: 0, ign: false, voltage: 12.5 });
  assert.deepEqual(eng.sweep(PLANNED + 3 * 3600_000).alerts, []);
});

test("detenido fuera de una parada más de 15 minutos con el viaje en curso: avisa", () => {
  const ps = trip();
  const k = ps.findIndex((p) => p.t > PLANNED + 15 * 60_000);
  const stuck = [...ps.slice(0, k), ...Array.from({ length: 160 }, (_, i) => ({ ...ps[k], t: ps[k].t + i * 7000, speed: 0 })), ...ps.slice(k).map((p) => ({ ...p, t: p.t + 160 * 7000 }))];
  const r = run(config(), stuck);
  assert.equal(r.alertsOf("detenido").length, 1);
});

test("batería baja con el motor encendido: avisa una vez y cierra al recuperarse", () => {
  const ps = trip().map((p, i) => (i >= 50 && i < 70 ? { ...p, voltage: 10.2 } : p));
  const r = run(config(), ps);
  const a = r.alertsOf("bateria");
  assert.equal(a.length, 1); assert.ok(a[0].endedAt);
});

test("tras un reinicio del servidor el viaje continúa donde estaba (estado guardado en la base)", () => {
  const ps = trip();
  const e1 = createEngine();
  const mid = 250;
  const a = run(config(), ps.slice(0, mid), { engine: e1 });
  // lo que se guardó en vehicle_state.engine, viajando como JSON
  const saved = JSON.parse(JSON.stringify(a.states.at(-1).engine));
  const e2 = createEngine();
  const cfg = config({ trip: { status: "en_curso", startedAt: a.trips.find((t) => t.status === "en_curso").startedAt } });
  cfg.states = [{ vehicleId: "v1", engine: saved }];
  const b = run(cfg, ps.slice(mid), { engine: e2 });
  assert.equal(b.lastTrip.status, "completado");
  assert.equal(a.alerts.size + b.alerts.size, 0);
  for (const i of [2, 3]) assert.equal(b.stops.get(i).status, "ok");
});

test("vehículo sin viaje asignado: solo eventos de geocercas, nada de viaje", () => {
  const cfg = config(); cfg.trips = [];
  const r = run(cfg, trip());
  assert.equal(r.trips.length, 0);
  assert.ok(r.events.length >= 6);
  assert.deepEqual(r.kinds, []);
});

test("los datos de un equipo desconocido no se asocian a ningún vehículo", () => {
  const e = createEngine(); e.setConfig(config());
  assert.equal(e.vehicleForDevice("999"), null);
  assert.equal(e.vehicleForDevice("860012345678901").code, "INT 110");
});
