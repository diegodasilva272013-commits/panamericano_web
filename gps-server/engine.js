// Motor de eventos de la flota. Recibe cada posición (en orden) y decide: entradas/salidas de geocercas, avance del viaje
// (salida, paradas, llegada, atraso), sentido de marcha, desvío de ruta, exceso de velocidad, detenciones y falta de señal.
// Es una función pura sobre un estado por vehículo: no toca red ni base. Eso permite probarlo con recorridos simulados y reproducirlo
// sobre el historial guardado. El servidor lo alimenta y guarda lo que devuelve.
import { distance, angleDiff, inFence, segmentTouchesFence, cumulative, project } from "./geo.js";

export const DEFAULTS = { speedLimit: 90, speedGraceS: 10, noSignalMin: 10, delayTolMin: 5, stopRadiusM: 120, idleStopMin: 15, lowVoltage: 11.0 };
const STOPPED_KMH = 5;          // por debajo de esto se considera detenido (frenó en la parada)
const MAX_SEGMENT_GAP_MS = 120_000; // si pasó más tiempo entre dos posiciones, no se asume que fue en línea recta
const OFF_ROUTE_AFTER_MS = 60_000;
const BACK_ALERT_M = 600;       // metros hacia atrás sobre la ruta para avisar sentido contrario
const WRONG_HEADING_DEG = 135;
const WRONG_HEADING_SAMPLES = 5;
const iso = (ms) => new Date(ms).toISOString();
const jujuyMs = (date, time) => Date.parse(`${String(date).slice(0, 10)}T${time}:00-03:00`); // Jujuy no usa horario de verano: siempre UTC-3

const emptyOut = () => ({ events: [], alerts: [], trips: [], stops: [], late: false });
export const mergeOut = (a, b) => { for (const k of ["events", "alerts", "trips", "stops"]) a[k].push(...b[k]); return a; };

export function createEngine() {
  let cfg = { settings: { ...DEFAULTS }, vehicles: [], geofences: [], routes: [], trips: [] };
  let fences = [], fenceById = new Map(), routeById = new Map(), byDevice = new Map(), tripsByVehicle = new Map();
  const S = new Map();            // vehicleId -> estado
  const done = new Set();         // viajes que el motor ya cerró (por si la configuración todavía los trae como en curso)

  const settings = () => ({ ...DEFAULTS, ...cfg.settings });

  function setConfig(c) {
    cfg = { settings: c.settings || {}, vehicles: c.vehicles || [], geofences: c.geofences || [], routes: c.routes || [], trips: c.trips || [] };
    fences = cfg.geofences.filter((g) => (g.shape === "polygon" ? Array.isArray(g.polygon) && g.polygon.length >= 3 : g.lat != null && g.lng != null && g.radiusM));
    fenceById = new Map(fences.map((g) => [g.id, g]));
    routeById = new Map(cfg.routes.map((r) => { const line = r.polyline || []; return [r.routeId, { ...r, line, cum: cumulative(line), stopsByIdx: new Map((r.stops || []).map((s) => [s.idx, s])), last: Math.max(-1, ...(r.stops || []).map((s) => s.idx)) }]; }));
    byDevice = new Map(cfg.vehicles.filter((v) => v.deviceId).map((v) => [String(v.deviceId), v]));
    tripsByVehicle = new Map();
    for (const t of cfg.trips) {
      if (!t.vehicleId) continue;
      const planned = t.plannedAt ? Date.parse(t.plannedAt) : jujuyMs(t.date, t.time);
      (tripsByVehicle.get(t.vehicleId) || tripsByVehicle.set(t.vehicleId, []).get(t.vehicleId)).push({ ...t, planned });
    }
    // estados guardados en la base (tras un reinicio del servidor)
    for (const st of c.states || []) if (st.vehicleId && !S.has(st.vehicleId) && st.engine && st.engine.v === 1) S.set(st.vehicleId, st.engine);
  }

  const vehicleForDevice = (deviceId) => byDevice.get(String(deviceId)) || null;

  /** Olvida todo lo derivado de un coche (para rehacerlo desde el historial). */
  function resetVehicle(vehicleId, fromMs = 0) {
    S.delete(vehicleId);
    for (const t of cfg.trips) if (t.vehicleId === vehicleId) done.delete(t.id);
    // los viajes de la ventana se recalculan desde cero: vuelven a "programado" (la base hace lo mismo al reconstruir)
    for (const t of tripsByVehicle.get(vehicleId) || []) if (t.planned >= fromMs && t.status !== "cancelado") { t.status = "programado"; t.startedAt = null; }
  }
  /** Viajes asignados al coche desde un instante en adelante (los que una reconstrucción tiene que volver a calcular). */
  const tripIds = (vehicleId, fromMs) => (tripsByVehicle.get(vehicleId) || []).filter((t) => t.planned >= fromMs).map((t) => t.id);
  /** Desde cuándo conviene rehacer un coche si llegó un dato de `tMs`: el viaje asignado que lo contiene (para no inventar paradas omitidas), o media hora antes. */
  function replayStart(vehicleId, tMs) {
    const t = (tripsByVehicle.get(vehicleId) || []).filter((x) => tMs >= x.planned - 60 * 60_000 && tMs <= x.planned + 12 * 3600_000).sort((a, b) => a.planned - b.planned)[0];
    return t ? t.planned - 60 * 60_000 : tMs - 30 * 60_000;
  }
  const fresh = () => ({ v: 1, t: null, rx: null, lat: null, lng: null, speed: 0, course: 0, ign: false, inside: [], over: null, speeding: null, trip: null, off: null, idle: null, lowV: null, silent: null });
  const stateOf = (id) => S.get(id) || S.set(id, fresh()).get(id);

  // el viaje que le corresponde al vehículo ahora: el que ya está en curso, o el programado más cercano a esta hora
  function pickTrip(vehicleId, nowMs, s) {
    const list = tripsByVehicle.get(vehicleId) || [];
    if (s.trip) { const t = list.find((x) => x.id === s.trip.id); if (t) return t; }
    const live = list.find((t) => t.status === "en_curso" && !done.has(t.id));
    if (live) return live;
    const cand = list.filter((t) => !done.has(t.id) && t.status === "programado" && nowMs >= t.planned - 90 * 60_000 && nowMs <= t.planned + 8 * 3600_000)
      .sort((a, b) => Math.abs(a.planned - nowMs) - Math.abs(b.planned - nowMs));
    return cand[0] || null;
  }

  function ingest(vehicleId, p, rxMs = p.t) {
    const out = emptyOut();
    const s = stateOf(vehicleId), set = settings();
    if (s.t != null && p.t <= s.t) { out.late = true; return { out, state: null }; } // llega tarde: se guarda en el historial, pero no mueve el estado actual
    const cur = [p.lat, p.lng], prev = s.lat != null ? [s.lat, s.lng] : null;
    const gap = s.t != null ? p.t - s.t : 0;
    const at = iso(p.t), base = { vehicleId, lat: p.lat, lng: p.lng };
    const alert = (a) => out.alerts.push({ ...base, at, tripId: s.trip?.id || null, severity: "aviso", detail: "", data: {}, ...a });

    // vuelve a transmitir tras un silencio
    if (s.silent) { out.alerts.push({ ...base, at, vehicleId, key: s.silent.key, kind: "sin_senal", severity: "aviso", title: "Sin señal", endedAt: at, data: {}, tripId: s.trip?.id || null }); s.silent = null; }

    // ---- geocercas
    const wasIn = new Set(s.inside), nowIn = new Set();
    const crossed = [];
    for (const g of fences) {
      const inside = inFence(cur, g), was = wasIn.has(g.id);
      const touched = !inside && !was && prev && gap > 0 && gap <= MAX_SEGMENT_GAP_MS && segmentTouchesFence(prev, cur, g);
      if (inside) nowIn.add(g.id);
      if (!was && (inside || touched)) { crossed.push({ g, kind: "entra", pass: touched }); if (touched) crossed.push({ g, kind: "sale", pass: true }); }
      else if (was && !inside) crossed.push({ g, kind: "sale", pass: false });
    }
    for (const c of crossed) {
      out.events.push({ ...base, geofenceId: c.g.id, kind: c.kind, at, speed: p.speed, tripId: s.trip?.id || null });
      if (c.kind === "entra" && c.g.kind === "restringida") alert({ key: `rest:${c.g.id}:${p.t}`, kind: "geocerca_restringida", severity: "critica", title: `Entró a una zona prohibida: ${c.g.name}`, data: { geofenceId: c.g.id } });
    }
    s.inside = [...nowIn];

    // ---- viaje: asignación, paradas, salida y llegada
    if (!s.trip) {
      const t = pickTrip(vehicleId, p.t, s);
      if (t && routeById.has(t.routeId)) s.trip = { id: t.id, routeId: t.routeId, planned: t.planned, status: t.status, started: t.status === "en_curso", startedAt: t.startedAt ? Date.parse(t.startedAt) : null, visited: {}, maxIdx: -1, along: null, back: 0, wrongN: 0, dist: 0, maxSpeed: 0, idleAlerted: false };
    }
    const T = s.trip, R = T && routeById.get(T.routeId);
    if (T && R) tripStep({ T, R, s, p, cur, prev, crossed, out, alert, at, set, base });

    // ---- velocidad: el límite de una zona manda sobre el general
    let limit = set.speedLimit;
    for (const id of nowIn) { const g = fenceById.get(id); if (g?.kind === "zona" && g.speedLimit) limit = Math.min(limit, g.speedLimit); }
    if (p.speed > limit) {
      if (!s.over) s.over = { since: p.t, max: p.speed, limit };
      s.over.max = Math.max(s.over.max, p.speed); s.over.limit = limit;
      if (!s.speeding && p.t - s.over.since >= set.speedGraceS * 1000) s.speeding = { key: `vel:${s.over.since}`, since: s.over.since };
      if (s.speeding) alert({ key: s.speeding.key, kind: "exceso_velocidad", severity: s.over.max >= limit + 20 ? "critica" : "aviso", title: "Exceso de velocidad", detail: `${s.over.max} km/h (límite ${limit} km/h)`, data: { maxSpeed: s.over.max, limit }, at: iso(s.speeding.since) });
    } else if (s.over) {
      if (s.speeding) alert({ key: s.speeding.key, kind: "exceso_velocidad", severity: s.over.max >= s.over.limit + 20 ? "critica" : "aviso", title: "Exceso de velocidad", detail: `${s.over.max} km/h (límite ${s.over.limit} km/h)`, data: { maxSpeed: s.over.max, limit: s.over.limit }, at: iso(s.speeding.since), endedAt: at });
      s.over = null; s.speeding = null;
    }

    // ---- alimentación
    if (p.voltage != null) {
      const low = p.voltage > 5 && p.voltage < set.lowVoltage && p.ign;
      if (low && !s.lowV) { s.lowV = { key: `bat:${p.t}` }; alert({ key: s.lowV.key, kind: "bateria", title: "Batería baja del vehículo", detail: `${p.voltage.toFixed(1)} V`, data: { voltage: p.voltage } }); }
      else if (!low && s.lowV) { alert({ key: s.lowV.key, kind: "bateria", title: "Batería baja del vehículo", endedAt: at }); s.lowV = null; }
    }

    s.t = p.t; s.rx = rxMs; s.lat = p.lat; s.lng = p.lng; s.speed = p.speed; s.course = p.course; s.ign = p.ign;
    const state = { ...base, vehicleId, t: at, speed: p.speed, course: p.course, ign: p.ign, voltage: p.voltage ?? null, odometerM: p.odometerM ?? null, sats: p.sats ?? null, csq: p.csq ?? null, tripId: s.trip?.id || null, inside: s.inside, engine: s };
    return { out, state };
  }

  function tripStep({ T, R, s, p, cur, prev, crossed, out, alert, at, set }) {
    const tol = set.delayTolMin;
    const visit = (idx) => T.visited[idx] || (T.visited[idx] = { arr: null, dep: null, stopped: false, done: false });
    const stopRow = (idx, extra) => { const st = R.stopsByIdx.get(idx); out.stops.push({ tripId: T.id, idx, geofenceId: st.geofenceId, name: st.name, status: "pendiente", ...extra }); };
    const plannedAtStop = (st) => (st.idx === 0 ? T.planned : st.offsetMin != null ? T.planned + st.offsetMin * 60_000 : null);
    const tripRow = (extra = {}) => out.trips.push({ id: T.id, distanceM: Math.round(T.dist), maxSpeed: T.maxSpeed, lastStopIdx: T.maxIdx, ...extra });

    if (prev) T.dist += p.speed > 0 || s.speed > 0 ? distance(prev, cur) : 0;
    T.maxSpeed = Math.max(T.maxSpeed, p.speed);

    const stopOfFence = (gid) => (R.stops || []).find((x) => x.geofenceId === gid);
    // ¿frenó dentro de la parada? (cualquier posición con velocidad casi nula mientras está adentro)
    for (const id of s.inside.concat(crossed.filter((c) => c.kind === "entra").map((c) => c.g.id))) {
      const st = stopOfFence(id); if (!st) continue;
      const v = T.visited[st.idx]; if (v && v.arr != null && !v.done && (p.speed <= STOPPED_KMH || !p.ign)) v.stopped = true;
    }
    for (const c of crossed) {
      const st = stopOfFence(c.g.id); if (!st) continue;
      const v = visit(st.idx);
      if (c.kind === "entra") {
        if (v.arr == null) {
          v.arr = p.t; v.stopped = p.speed <= STOPPED_KMH || !p.ign;
          // salto de orden: si ya pasó por una parada posterior, va al revés
          if (st.idx < T.maxIdx) alert({ key: `dir:${T.id}:order:${p.t}`, kind: "sentido_contrario", severity: "critica", title: "Sentido contrario", detail: `Llegó a ${st.name} después de una parada posterior del recorrido`, data: { stop: st.name } });
          // no arrancó formalmente pero ya llegó a otra parada: el viaje empezó
          if (!T.started && st.idx > 0) { T.started = true; T.startedAt = T.startedAt ?? p.t; tripRow({ status: "en_curso", startedAt: iso(T.startedAt) }); }
          T.maxIdx = Math.max(T.maxIdx, st.idx);
          const plan = plannedAtStop(st);
          const delay = plan != null && st.idx > 0 ? Math.round((p.t - plan) / 60_000) : null;
          stopRow(st.idx, { plannedAt: plan != null ? iso(plan) : undefined, arrivedAt: iso(p.t), delayMin: delay ?? undefined, status: "pendiente" });
          if (delay != null && delay > tol) alert({ key: `delay:${T.id}:${st.idx}`, kind: "atraso", title: `Atraso en ${st.name}`, detail: `${delay} min de atraso (tolerancia ${tol} min)`, data: { stop: st.name, delayMin: delay } });
          // las paradas anteriores que quedaron sin visitar
          for (const prevStop of R.stops) if (prevStop.idx < st.idx && prevStop.mandatory && !(T.visited[prevStop.idx]?.arr) && !T.visited[prevStop.idx]?.skipped) {
            visit(prevStop.idx).skipped = true;
            stopRow(prevStop.idx, { status: "omitida" });
            alert({ key: `skip:${T.id}:${prevStop.idx}`, kind: "parada_omitida", title: `No pasó por ${prevStop.name}`, detail: "El coche siguió de largo sin entrar a la parada.", data: { stop: prevStop.name } });
          }
          if (st.idx === R.last && R.last > 0) {  // llegó al destino: el viaje terminó
            done.add(T.id);
            const row = { id: T.id, status: "completado", endedAt: at, distanceM: Math.round(T.dist), maxSpeed: T.maxSpeed, lastStopIdx: st.idx };
            out.trips.push(row); stopRow(st.idx, { arrivedAt: iso(p.t), plannedAt: plan != null ? iso(plan) : undefined, delayMin: delay ?? undefined, status: "ok" });
            s.trip = null; return;
          }
        }
      } else if (v.arr != null && !v.done) { // sale
        v.dep = p.t; v.done = true;
        const frenó = v.stopped;
        const dwell = Math.round((v.dep - v.arr) / 1000);
        const status = frenó || !st.mandatory ? "ok" : "omitida";
        stopRow(st.idx, { arrivedAt: iso(v.arr), departedAt: iso(v.dep), dwellS: dwell, status });
        if (status === "omitida") alert({ key: `skip:${T.id}:${st.idx}`, kind: "parada_omitida", title: `No frenó en ${st.name}`, detail: "Pasó por la parada sin detenerse.", data: { stop: st.name } });
        if (st.idx === 0 && !T.started) { // salió del origen: arranca el viaje
          T.started = true; T.startedAt = p.t;
          const dep = Math.round((p.t - T.planned) / 60_000);
          tripRow({ status: "en_curso", startedAt: at });
          if (dep > tol) alert({ key: `delay:${T.id}:dep`, kind: "atraso", title: "Salió con atraso", detail: `${dep} min después de la hora programada (tolerancia ${tol} min)`, data: { delayMin: dep } });
        }
      }
    }

    if (!T.started || !R.line.length) { if (!R.line.length) detener(T, s, p, set, alert, at); return; }

    // ---- sentido y ruta (solo con el viaje en curso)
    const pr = project(R.line, R.cum, cur, T.along, 8000);
    if (pr) {
      if (pr.offM > R.corridorM) {
        if (!s.off) s.off = { since: p.t, key: `off:${T.id}:${p.t}`, alerted: false };
        if (!s.off.alerted && p.t - s.off.since >= OFF_ROUTE_AFTER_MS) { s.off.alerted = true; alert({ key: s.off.key, kind: "fuera_de_ruta", title: "Fuera del recorrido", detail: `A ${Math.round(pr.offM)} m de la ruta`, data: { offM: Math.round(pr.offM) }, at: iso(s.off.since) }); }
      } else if (s.off) { if (s.off.alerted) alert({ key: s.off.key, kind: "fuera_de_ruta", title: "Fuera del recorrido", endedAt: at, at: iso(s.off.since) }); s.off = null; }

      if (pr.offM <= R.corridorM && p.speed >= 15) {
        if (T.along != null) {
          const d = pr.along - T.along;
          T.back = d < -20 ? T.back + -d : Math.max(0, T.back - Math.max(d, 0));
        }
        T.wrongN = angleDiff(p.course, pr.heading) > WRONG_HEADING_DEG && p.speed >= 20 ? T.wrongN + 1 : 0;
        if ((T.back >= BACK_ALERT_M || T.wrongN >= WRONG_HEADING_SAMPLES) && !T.wrongKey) { T.wrongKey = `dir:${T.id}:${p.t}`; alert({ key: T.wrongKey, kind: "sentido_contrario", severity: "critica", title: "Va en sentido contrario", detail: "El coche avanza en dirección opuesta al recorrido.", data: { backM: Math.round(T.back) } }); }
        else if (T.wrongKey && T.back < 100 && T.wrongN === 0) { alert({ key: T.wrongKey, kind: "sentido_contrario", severity: "critica", title: "Va en sentido contrario", endedAt: at }); T.wrongKey = null; }
      }
      T.along = pr.along;
    }
    detener(T, s, p, set, alert, at);
  }

  // detenido mucho tiempo fuera de una parada, con el viaje en curso
  function detener(T, s, p, set, alert, at) {
    const inStop = s.inside.some((id) => { const g = fenceById.get(id); return g && (g.kind === "parada" || g.kind === "terminal"); });
    if (T.started && p.speed < 3 && !inStop) {
      if (!s.idle) s.idle = { since: p.t, key: `idle:${T.id}:${p.t}`, alerted: false };
      if (!s.idle.alerted && p.t - s.idle.since >= set.idleStopMin * 60_000) { s.idle.alerted = true; alert({ key: s.idle.key, kind: "detenido", title: "Detenido fuera de una parada", detail: `Hace ${set.idleStopMin} min o más`, data: {}, at: iso(s.idle.since) }); }
    } else if (s.idle) { if (s.idle.alerted) alert({ key: s.idle.key, kind: "detenido", title: "Detenido fuera de una parada", endedAt: at, at: iso(s.idle.since) }); s.idle = null; }
  }

  // Revisión periódica (la llama el servidor cada ~30 s): avisa los coches en servicio que dejaron de transmitir.
  function sweep(nowMs) {
    const out = emptyOut(), set = settings();
    for (const [vehicleId, s] of S) {
      if (s.rx == null || s.silent) continue;
      const enServicio = s.ign || (s.trip && s.trip.started);
      if (enServicio && nowMs - s.rx >= set.noSignalMin * 60_000) {
        s.silent = { key: `sin:${s.t}` };
        out.alerts.push({ vehicleId, tripId: s.trip?.id || null, key: s.silent.key, kind: "sin_senal", severity: "aviso", title: "Sin señal", detail: `No transmite hace ${set.noSignalMin} min o más`, data: {}, at: iso(s.rx), lat: s.lat, lng: s.lng });
      }
    }
    return out;
  }

  // Punto de control: si guardar el lote falla, el servidor no confirma (el equipo reintenta) y el motor vuelve a como estaba,
  // así los eventos de ese lote no se pierden ni quedan a medias.
  function checkpoint(vehicleIds) {
    const snap = new Map(), doneSnap = new Set(done);
    for (const id of new Set(vehicleIds)) snap.set(id, S.has(id) ? structuredClone(S.get(id)) : undefined);
    return () => {
      for (const [id, v] of snap) { if (v === undefined) S.delete(id); else S.set(id, v); }
      done.clear(); for (const d of doneSnap) done.add(d);
    };
  }

  return { setConfig, vehicleForDevice, ingest, resetVehicle, replayStart, tripIds, sweep, checkpoint, knownVehicles: () => [...S.keys()], vehicleIds: () => cfg.vehicles.filter((v) => v.deviceId).map((v) => v.id), state: (id) => S.get(id) || null, tripsDone: done };
}
