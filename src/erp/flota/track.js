// Cálculos sobre un recorrido (lista de posiciones ordenadas por hora). Sin pantalla: se prueba aparte.
import { distance, pointSegment } from "../../../gps-server/geo.js";

const MOVING_KMH = 5;
const MAX_GAP_S = 300; // un hueco de más de 5 min no se cuenta como tiempo ni como distancia recorrida (se perdió la señal)

/**
 * Resume un recorrido. positions: [{ event_time, lat, lng, speed, ignition }].
 * Devuelve distancia, velocidad máxima y media en marcha, tiempos y las detenciones (parado ≥ minStopS segundos).
 */
export function summarize(positions, { minStopS = 120, limit = 90 } = {}) {
  const out = { count: positions.length, distanceM: 0, maxSpeed: 0, avgMovingSpeed: 0, movingS: 0, idleS: 0, offS: 0, stops: [], overLimitS: 0, from: null, to: null };
  if (!positions.length) return out;
  out.from = positions[0].event_time; out.to = positions.at(-1).event_time;
  let sumSpeed = 0, nMoving = 0, stop = null;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    out.maxSpeed = Math.max(out.maxSpeed, p.speed || 0);
    const nxt = positions[i + 1];
    const t = Date.parse(p.event_time);
    const dt = nxt ? (Date.parse(nxt.event_time) - t) / 1000 : 0;
    const moving = (p.speed || 0) >= MOVING_KMH;
    if (nxt && dt > 0 && dt <= MAX_GAP_S) {
      out.distanceM += distance([p.lat, p.lng], [nxt.lat, nxt.lng]);
      if (moving) { out.movingS += dt; if ((p.speed || 0) > limit) out.overLimitS += dt; } else if (p.ignition) out.idleS += dt; else out.offS += dt;
    }
    if (moving) { sumSpeed += p.speed; nMoving++; }
    // detenciones
    if (!moving) { if (!stop) stop = { start: p.event_time, startMs: t, lat: p.lat, lng: p.lng, ignition: !!p.ignition }; stop.endMs = nxt ? Date.parse(nxt.event_time) : t; stop.end = nxt ? nxt.event_time : p.event_time; }
    if (moving || !nxt) {
      if (stop && (stop.endMs - stop.startMs) / 1000 >= minStopS) out.stops.push({ start: stop.start, end: stop.end, seconds: Math.round((stop.endMs - stop.startMs) / 1000), lat: stop.lat, lng: stop.lng, ignition: stop.ignition });
      stop = null;
    }
  }
  out.avgMovingSpeed = nMoving ? Math.round(sumSpeed / nMoving) : 0;
  return out;
}

/** Corridas de posiciones seguidas con la misma clase de velocidad, para dibujar la línea por colores. Cada una repite el último punto de la anterior. */
export function speedRuns(positions, limit = 90) {
  const cls = (s) => ((s || 0) < MOVING_KMH ? "stop" : s > limit ? "over" : s > limit * 0.8 ? "fast" : "ok");
  const runs = [];
  let cur = null;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i], c = cls(positions[i + 1] ? positions[i + 1].speed : p.speed);
    if (!cur || cur.cls !== c) { cur = { cls: c, pts: i > 0 ? [[positions[i - 1].lat, positions[i - 1].lng]] : [] }; runs.push(cur); }
    cur.pts.push([p.lat, p.lng]);
  }
  return runs.filter((r) => r.pts.length > 1);
}

/** Reduce una lista de puntos a lo que cabe en pantalla (para gráficos): cada tanto, conservando el máximo de cada tramo. */
export function downsampleMax(values, target = 400) {
  if (values.length <= target) return values.map((v, i) => ({ i, v }));
  const step = values.length / target, out = [];
  for (let k = 0; k < target; k++) {
    const a = Math.floor(k * step), b = Math.min(values.length, Math.floor((k + 1) * step));
    let best = a; for (let j = a; j < b; j++) if (values[j] > values[best]) best = j;
    out.push({ i: best, v: values[best] });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Trazados de recorrido


/** Reduce una poligonal [[lat,lng],...] a menos puntos sin apartarse más de `tolM` metros (Douglas-Peucker, sin recursión profunda). */
export function simplifyLine(line, tolM = 15) {
  if (line.length <= 2) return line.slice();
  const keep = new Uint8Array(line.length); keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, dmax = 0;
    for (let i = a + 1; i < b; i++) { const d = pointSegment(line[i], line[a], line[b]).dist; if (d > dmax) { dmax = d; far = i; } }
    if (far >= 0 && dmax > tolM) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

const fold = (x) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const STOP_WORDS = new Set(["terminal", "parada", "de", "la", "el", "san", "salvador", "del"]);

/** Busca entre las geocercas la que corresponde a una parada del panel por su nombre ("Purmamarca" ↔ "Terminal Purmamarca"). Devuelve la geocerca o null. */
export function matchFence(stopName, fences) {
  const s = fold(stopName); if (!s) return null;
  const exact = fences.find((g) => fold(g.name) === s); if (exact) return exact;
  const words = s.split(" ").filter((w) => !STOP_WORDS.has(w));
  const cands = fences.filter((g) => { const n = fold(g.name); return n.includes(s) || (words.length && words.every((w) => n.includes(w))); });
  return cands.length === 1 ? cands[0] : cands.find((g) => g.kind === "terminal" || g.kind === "parada") || null;
}

/** Invierte un recorrido: el trazado al revés y las paradas en orden contrario. */
export const reverseLine = (line) => line.slice().reverse();
