// Simulación para ver la app funcionando mientras los GPS todavía no están conectados.
// Usa el horario real de la web y los pueblos de la Ruta 9; los coches avanzan en tiempo real según ese horario.
// Devuelve lo mismo que las funciones de la base (public_routes y public_live), así la app no distingue el origen.
// Siempre se muestra con un aviso de "Simulación": nunca se presenta como dato real.
import { cumulative } from "../../gps-server/geo.js";

// pueblos de la Ruta 9 en orden, con su ubicación aproximada
const TRUNK = [
  ["San Salvador de Jujuy", -24.1858, -65.2995], ["Yala", -24.1214, -65.4022], ["León", -24.0414, -65.4314], ["Volcán", -23.9167, -65.4667],
  ["Tumbaya", -23.8575, -65.4675], ["Purmamarca", -23.7447, -65.4986], ["Maimará", -23.6236, -65.4083], ["Tilcara", -23.5776, -65.3944],
  ["Huacalera", -23.4372, -65.3497], ["Uquía", -23.3022, -65.3556], ["Humahuaca", -23.2056, -65.3507], ["Tres Cruces", -22.9167, -65.5853],
  ["Abra Pampa", -22.7225, -65.6972], ["La Quiaca", -22.1056, -65.5936],
];
const KMH = 58, DWELL_MIN = 2, TZ = "America/Argentina/Jujuy";
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\*$/, "").replace(/^jujuy$/, "san salvador de jujuy").trim();
const townIdx = (name) => TRUNK.findIndex((t) => norm(t[0]) === norm(name));
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };

// rutas de la web que van por la Ruta 9 (todas sus paradas son pueblos de la troncal)
function simRoutes(routes) {
  const out = [];
  for (const r of routes || []) {
    const ids = [r.from, ...(r.stops || [])].map(townIdx);
    if (ids.length < 2 || ids.some((i) => i < 0)) continue;
    const a = ids[0], b = ids.at(-1), dir = b > a ? 1 : -1;
    if (ids.some((i, k) => k && (i - ids[k - 1]) * dir <= 0)) continue;
    const towns = []; for (let i = a; i !== b + dir; i += dir) towns.push(TRUNK[i]);
    const line = towns.map((t) => [t[1], t[2]]), cum = cumulative(line);
    // paradas: las de la web; el horario de cada una sale de la distancia al ritmo previsto, más la espera en las anteriores
    const stops = ids.map((ti, k) => { const j = towns.findIndex((t) => t[0] === TRUNK[ti][0]); return { idx: k, name: TRUNK[ti][0], lat: TRUNK[ti][1], lng: TRUNK[ti][2], along: cum[j] }; });
    stops.forEach((s, k) => { s.offset_min = Math.round((s.along / 1000 / KMH) * 60 + k * DWELL_MIN); });
    out.push({ def: r, raw: { route_id: r.id, polyline: line, stops: stops.map(({ along, ...s }) => s) }, line, cum, stops });
  }
  return out;
}

const dayISO = (ms) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(ms);
const atLocal = (day, hm) => Date.parse(`${day}T${hm}:00-03:00`);
function pointAt(line, cum, along) {
  let i = 0; while (i < line.length - 2 && cum[i + 1] < along) i++;
  const t = Math.max(0, Math.min(1, (along - cum[i]) / ((cum[i + 1] - cum[i]) || 1)));
  return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
}

export function simulate(routes, now = Date.now(), runsOn = () => true) {
  const rs = simRoutes(routes), trips = [];
  for (const R of rs) {
    const total = R.stops.at(-1).offset_min;
    for (const dayMs of [now - 86400_000, now]) {
      const day = dayISO(dayMs);
      for (const hm of R.def.times || []) {
        if (R.def.days?.[hm] && !runsOn(R.def.days[hm], day)) continue;
        const planned = atLocal(day, hm), id = `sim-${R.def.id}-${day}-${hm.replace(":", "")}`;
        const late = Math.round(hash(id) * 6) * 60_000; // cada salida con su pequeño atraso, siempre el mismo
        const coach = `INT ${110 + Math.floor(hash(id + "c") * 29)}`;
        const start = planned + late, end = start + total * 60_000;
        if (now > end + 3 * 60_000) continue;
        if (now < start) {
          if (planned - now <= 3 * 3600_000) trips.push({ id, route_id: R.def.id, trip_time: hm, status: "programado", planned_at: new Date(planned).toISOString(), started_at: null, coach, pos: null, stops: [] });
          continue;
        }
        // dónde va: en una parada (esperando) o entre dos, al ritmo previsto
        const m = (now - start) / 60_000;
        let along = R.stops.at(-1).along, moving = false;
        const done = [];
        const last = R.stops.length - 1, leaveOf = (k) => R.stops[k].offset_min + (k > 0 && k < last ? DWELL_MIN : 0);
        for (let k = 0; k <= last; k++) {
          const s = R.stops[k], arr = s.offset_min;
          if (k && m < arr) { const p = R.stops[k - 1], t0 = leaveOf(k - 1), f = Math.max(0, Math.min(1, (m - t0) / ((arr - t0) || 1))); along = p.along + (s.along - p.along) * f; moving = f > 0 && f < 1; break; }
          const leave = leaveOf(k);
          done.push({ idx: s.idx, status: "ok", arrived_at: new Date(start + arr * 60_000).toISOString(), departed_at: m >= leave ? new Date(start + leave * 60_000).toISOString() : null, delay_min: Math.round(late / 60_000) });
          if (m < leave) { along = s.along; moving = false; break; }
        }
        const [lat, lng] = pointAt(R.line, R.cum, along);
        trips.push({ id, route_id: R.def.id, trip_time: hm, status: "en_curso", planned_at: new Date(planned).toISOString(), started_at: new Date(start).toISOString(), coach,
          pos: { lat, lng, moving, at: new Date(now - 3000).toISOString() }, stops: done });
      }
    }
  }
  trips.sort((a, b) => Date.parse(a.planned_at) - Date.parse(b.planned_at));
  return { routes: rs.map((r) => r.raw), live: { now: new Date(now).toISOString(), trips } };
}
