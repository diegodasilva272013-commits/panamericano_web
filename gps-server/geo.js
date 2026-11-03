// Geometría sobre la esfera, en metros. Se usa en el motor de eventos (servidor) y en el mapa del ERP.
// Todas las coordenadas son [lat, lng] en grados.

const R = 6371008.8; // radio medio de la Tierra
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distancia entre dos puntos (haversine), en metros. */
export function distance(a, b) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rumbo inicial de a hacia b, en grados 0-359. */
export function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Diferencia angular más corta entre dos rumbos, 0-180. */
export const angleDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

// Proyección local plana (metros) alrededor de un punto de referencia: suficiente para distancias de cientos de metros a pocos km.
function local(ref) {
  const k = Math.cos(rad(ref[0]));
  return (p) => [rad(p[1] - ref[1]) * k * R, rad(p[0] - ref[0]) * R]; // [x este, y norte]
}

/** Distancia mínima de un punto p al segmento a-b, en metros, y la fracción t (0-1) del punto más cercano. */
export function pointSegment(p, a, b) {
  const f = local(a), P = f(p), B = f(b);
  const len2 = B[0] ** 2 + B[1] ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (P[0] * B[0] + P[1] * B[1]) / len2));
  return { dist: Math.hypot(P[0] - t * B[0], P[1] - t * B[1]), t };
}

/** ¿El tramo recorrido entre dos posiciones (a → b) pasó a menos de `radius` metros del centro c? Evita perder una parada entre dos reportes. */
export const segmentHitsCircle = (a, b, c, radius) => pointSegment(c, a, b).dist <= radius;

/** Punto dentro de un polígono [[lat,lng],...] (regla del rayo). */
export function inPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** ¿El tramo a → b toca el polígono (termina dentro, empieza dentro o cruza algún borde)? */
export function segmentHitsPolygon(a, b, poly) {
  if (inPolygon(a, poly) || inPolygon(b, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segmentsCross(a, b, poly[j], poly[i])) return true;
  return false;
}

/** ¿El punto está dentro de la geocerca g? (círculo { lat, lng, radiusM } o polígono { polygon }). */
export function inFence(p, g) {
  return g.shape === "polygon" ? inPolygon(p, g.polygon) : distance(p, [g.lat, g.lng]) <= g.radiusM;
}
/** ¿El tramo a → b tocó la geocerca g? */
export function segmentTouchesFence(a, b, g) {
  return g.shape === "polygon" ? segmentHitsPolygon(a, b, g.polygon) : segmentHitsCircle(a, b, [g.lat, g.lng], g.radiusM);
}

/** Largo total de una poligonal, en metros, y la distancia acumulada hasta cada vértice. */
export function cumulative(line) {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + distance(line[i - 1], line[i]));
  return out;
}

/**
 * Ubica un punto sobre una poligonal: avance en metros desde el inicio, distancia lateral a la ruta y rumbo de la ruta en ese punto.
 * `hint` (avance previo) y `window` limitan la búsqueda cerca de donde estaba, para no confundirse en rutas que pasan dos veces cerca.
 */
export function project(line, cum, p, hint = null, window = 5000) {
  let best = null;
  for (let i = 0; i < line.length - 1; i++) {
    if (hint != null && (cum[i + 1] < hint - window || cum[i] > hint + window)) continue;
    const { dist, t } = pointSegment(p, line[i], line[i + 1]);
    if (!best || dist < best.offM) best = { offM: dist, along: cum[i] + t * (cum[i + 1] - cum[i]), heading: bearing(line[i], line[i + 1]), seg: i };
  }
  if (!best && hint != null) return project(line, cum, p, null);
  return best;
}
