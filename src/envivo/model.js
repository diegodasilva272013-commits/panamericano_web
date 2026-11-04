// "En vivo" para pasajeros: cálculos puros (sin pantalla) para poder probarlos.
// Dónde va el coche sobre su ruta, qué paradas ya hizo, cuánto falta a cada una y la altura del camino.
import { cumulative, project, distance } from "../../gps-server/geo.js";

export const STALE_MS = 3 * 60_000; // más de 3 minutos sin datos: las estimaciones pasan a "aprox."
export const LOST_MS = 10 * 60_000; // más de 10 minutos: sin señal, se muestra la última posición conocida
const DEFAULT_KMH = 55; // ritmo para estimar cuando la parada no tiene horario cargado
const AT_STOP_M = 250;

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^terminal\s+/, "").trim();
const ALIAS = { "san salvador de jujuy": "jujuy" };
const key = (s) => { const n = norm(s); return ALIAS[n] || n; };
export const sameStop = (a, b) => key(a) === key(b);
export const shortName = (s) => ({ "San Salvador de Jujuy": "Jujuy", "Terminal Jujuy": "Jujuy" }[s] || s);

// Ruta lista para dibujar: distancias acumuladas, paradas proyectadas sobre el trazado y el perfil de altura.
// `content` es el contenido de la web (para el nombre del servicio y la altura de los pueblos de la Ruta 9).
export function buildRoute(raw, content = {}) {
  const line = (raw.polyline || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (line.length < 2) return null;
  const cum = cumulative(line), length = cum.at(-1);
  let hint = 0;
  const stops = (raw.stops || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).map((s) => {
    const pr = project(line, cum, [s.lat, s.lng]);
    const along = Math.max(pr ? pr.along : hint, hint); hint = along;
    return { idx: s.idx, name: s.name, short: shortName(s.name), along, lat: s.lat, lng: s.lng, offset: Number.isFinite(s.offset_min) ? s.offset_min : null };
  });
  const def = (content.routes || []).find((r) => r.id === raw.route_id);
  const from = def?.from || stops[0]?.name || "", to = (def?.to || stops.at(-1)?.name || "").replace(/\*$/, "");
  return { id: raw.route_id, name: `${shortName(from)} → ${shortName(to)}`, from, to, via: def?.via || "", line, cum, length, stops, profile: profileFor(stops, content.journey || []) };
}

// Altura del camino a lo largo del recorrido. Se ancla en los pueblos que la web ya tiene con altura y kilómetro
// (Ruta 9) y se interpola entre ellos. Si la ruta no pasa por esos pueblos, el camino queda plano (no se inventa).
export function profileFor(stops, journey) {
  const pairs = [];
  for (const s of stops) { const j = journey.find((x) => sameStop(x.name, s.name) || sameStop(x.short, s.name)); if (j && Number.isFinite(j.km)) pairs.push([j.km, s.along]); }
  let pts = [];
  if (pairs.length >= 2) {
    // los kilómetros de la ruta se pasan a metros del recorrido con los pueblos en común; así entran también los que no son parada
    const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
    const kmToAlong = (km) => {
      if (km < sorted[0][0] || km > sorted.at(-1)[0]) return null;
      for (let i = 0; i < sorted.length - 1; i++) { const [k0, a0] = sorted[i], [k1, a1] = sorted[i + 1]; if (km <= k1) return a0 + ((km - k0) / ((k1 - k0) || 1)) * (a1 - a0); }
      return sorted.at(-1)[1];
    };
    pts = journey.filter((j) => Number.isFinite(j.alt) && Number.isFinite(j.km)).map((j) => [kmToAlong(j.km), j.alt]).filter(([a]) => a != null).sort((a, b) => a[0] - b[0]);
  }
  const known = pts.length >= 2;
  const lo = known ? Math.min(...pts.map((p) => p[1])) : 0, hi = known ? Math.max(...pts.map((p) => p[1])) : 0;
  const alt = (along) => {
    if (!known) return 0;
    if (along <= pts[0][0]) return pts[0][1];
    if (along >= pts.at(-1)[0]) return pts.at(-1)[1];
    let i = 0; while (i < pts.length - 2 && pts[i + 1][0] < along) i++;
    const [a0, h0] = pts[i], [a1, h1] = pts[i + 1], t = (along - a0) / ((a1 - a0) || 1);
    return h0 + (h1 - h0) * (t * t * (3 - 2 * t)); // curva suave entre pueblos
  };
  return { known, lo, hi, alt };
}

// Ritmo previsto de cada tramo (m/s) según los minutos cargados en las paradas; si falta, el ritmo por defecto.
function legSpeeds(stops) {
  const v = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1], d = b.along - a.along;
    v.push(a.offset != null && b.offset != null && b.offset > a.offset && d > 0 ? d / ((b.offset - a.offset) * 60) : DEFAULT_KMH / 3.6);
  }
  return v;
}

const ms = (iso) => (iso ? Date.parse(iso) : NaN);

// Estado de un viaje para mostrar: posición sobre la ruta, paradas hechas, próxima parada y horario estimado de cada una.
export function tripView(route, trip, now) {
  const stops = route.stops, legs = legSpeeds(stops), done = new Map((trip.stops || []).map((s) => [s.idx, s]));
  const planned = ms(trip.planned_at);
  const base = {
    id: trip.id, route, coach: trip.coach || "", tripTime: trip.trip_time, status: trip.status, planned,
    started: ms(trip.started_at), along: 0, at: NaN, moving: false, age: Infinity, freshness: "none",
    passed: -1, next: 0, etas: new Map(), where: "", legSpeed: 0,
  };
  // todavía no salió: se muestra el horario
  if (trip.status !== "en_curso") {
    for (const s of stops) if (s.offset != null && Number.isFinite(planned)) base.etas.set(s.idx, { at: planned + s.offset * 60_000, kind: "horario" });
    base.where = `Sale a las ${trip.trip_time} de ${shortName(route.from)}`;
    return base;
  }
  let along = 0, at = NaN;
  if (trip.pos && Number.isFinite(trip.pos.lat)) {
    const pr = project(route.line, route.cum, [trip.pos.lat, trip.pos.lng]);
    along = pr ? pr.along : 0; at = ms(trip.pos.at);
  }
  // paradas ya hechas: lo que registró el sistema, o las que el coche ya dejó atrás
  let passed = -1;
  stops.forEach((s, i) => { const d = done.get(s.idx); if ((d && (d.status === "ok" || d.status === "omitida")) || along >= s.along + AT_STOP_M) passed = Math.max(passed, i); });
  const age = Number.isFinite(at) ? now - at : Infinity;
  const freshness = !Number.isFinite(at) ? "none" : age > LOST_MS ? "lost" : age > STALE_MS ? "stale" : "live";
  const next = Math.min(passed + 1, stops.length - 1);
  const legIdx = Math.max(0, Math.min(legs.length - 1, next - 1));
  const out = { ...base, along, at, age, freshness, passed, next, moving: !!trip.pos?.moving && freshness === "live", legSpeed: legs[legIdx] || DEFAULT_KMH / 3.6 };

  // horario estimado: lo que falta del tramo actual más los tramos siguientes, al ritmo previsto de cada uno.
  // Sin señal se cae al horario programado más el último atraso conocido.
  const lastDelay = [...done.values()].filter((d) => Number.isFinite(d.delay_min)).sort((a, b) => b.idx - a.idx)[0]?.delay_min || 0;
  if (freshness === "live" || freshness === "stale") {
    const from = Math.max(now, Number.isFinite(at) ? at : now);
    let t = from, pos = along;
    for (let i = next; i < stops.length; i++) {
      if (i <= passed) continue;
      const seg = Math.max(0, i - 1);
      t += (Math.max(0, stops[i].along - pos) / (legs[seg] || DEFAULT_KMH / 3.6)) * 1000;
      pos = stops[i].along;
      out.etas.set(stops[i].idx, { at: Math.max(t, now), kind: freshness === "live" ? "estimado" : "aprox" });
    }
  } else if (Number.isFinite(planned)) {
    for (let i = passed + 1; i < stops.length; i++) if (stops[i].offset != null) out.etas.set(stops[i].idx, { at: Math.max(now, planned + (stops[i].offset + lastDelay) * 60_000), kind: "horario" });
  }
  for (const s of stops) { const d = done.get(s.idx); if (d?.arrived_at || d?.departed_at) out.etas.set(s.idx, { at: ms(d.departed_at || d.arrived_at), kind: "hecho" }); else if (d?.status === "omitida") out.etas.set(s.idx, { at: NaN, kind: "omitida" }); }

  // en palabras
  const near = stops.findIndex((s) => Math.abs(s.along - along) < AT_STOP_M);
  if (freshness === "none") out.where = "Esperando la primera señal del coche";
  else if (near >= 0 && !out.moving) out.where = `En ${stops[near].short}`;
  else if (passed >= stops.length - 1) out.where = `Llegando a ${stops.at(-1).short}`;
  else if (passed < 0) out.where = `Saliendo de ${shortName(route.from)}`;
  else out.where = `Entre ${stops[passed].short} y ${stops[next].short}`;
  return out;
}

// Posición para dibujar entre una señal y la siguiente: avanza al ritmo del tramo, nunca más de 90 s
// ni más allá de la próxima parada (ahí espera a que el GPS confirme).
export function displayAlong(v, now) {
  if (!v.moving || !Number.isFinite(v.at)) return v.along;
  const dt = Math.min(90_000, Math.max(0, now - v.at)) / 1000;
  const cap = v.route.stops[v.next] ? Math.max(v.along, v.route.stops[v.next].along - 40) : v.route.length;
  return Math.min(v.along + v.legSpeed * dt, cap, v.route.length);
}

export const fmtClock = (t) => (Number.isFinite(t) ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Jujuy", hour: "2-digit", minute: "2-digit", hour12: false }).format(t) : "");
export function fmtIn(t, now) {
  if (!Number.isFinite(t)) return "";
  const m = Math.round((t - now) / 60_000);
  if (m <= 0) return "llegando";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
export const fmtAgo = (age) => (!Number.isFinite(age) ? "" : age < 60_000 ? `hace ${Math.max(1, Math.round(age / 1000))} s` : age < 3600_000 ? `hace ${Math.round(age / 60_000)} min` : `hace ${Math.round(age / 3600_000)} h`);

export { distance };
