// Genera recorridos realistas de un coche sobre una ruta: arranque, crucero, frenadas en las paradas, tiempos de espera.
// Sirve para probar el motor de eventos y para el simulador de GPS (que lo manda por la red con el formato del equipo real).
import { cumulative, bearing } from "./geo.js";

/** Punto sobre la poligonal a `along` metros del inicio, con el rumbo de ese tramo. */
export function pointAt(line, cum, along) {
  const a = Math.max(0, Math.min(along, cum.at(-1)));
  let i = 0;
  while (i < line.length - 2 && cum[i + 1] < a) i++;
  const seg = cum[i + 1] - cum[i] || 1, t = (a - cum[i]) / seg;
  return { lat: line[i][0] + (line[i + 1][0] - line[i][0]) * t, lng: line[i][1] + (line[i + 1][1] - line[i][1]) * t, course: Math.round(bearing(line[i], line[i + 1])) };
}

/**
 * Recorrido paso a paso. Devuelve [{ t (ms), lat, lng, speed, course, ign, voltage, odometerM, sats, csq }].
 *  stops:   [{ along, dwellS, stop: true|false }]  paradas a lo largo de la ruta; stop:false = pasa de largo sin frenar.
 *  cruise:  velocidad de crucero (km/h) o función (along) => km/h para forzar excesos en ciertos tramos.
 *  every:   segundos entre reportes.
 */
export function drive({ line, startMs, every = 7, cruise = 75, stops = [], from = 0, to = null, reverse = false, dwellAtStart = 0, jitter = 0 }) {
  const cum = cumulative(line), end = to ?? cum.at(-1);
  const out = [];
  let t = startMs, along = from, odo = 0, i = 0;
  const speedAt = typeof cruise === "function" ? cruise : () => cruise;
  const push = (speed, ign = true) => {
    const p = pointAt(line, cum, reverse ? cum.at(-1) - along : along);
    const course = reverse ? (p.course + 180) % 360 : p.course;
    out.push({ t, lat: p.lat + jitter * (Math.sin(t) * 1e-5), lng: p.lng, speed: Math.round(speed), course, ign, voltage: 12.6, odometerM: Math.round(odo), sats: 10, csq: 18 });
  };
  const wait = (s) => { for (let k = 0; k < Math.max(1, Math.round(s / every)); k++) { push(0); t += every * 1000; } };
  if (dwellAtStart) wait(dwellAtStart);
  const queue = [...stops].sort((a, b) => a.along - b.along);
  while (along < end - 1) {
    const next = queue.find((s) => s.along > along - 1);
    const v = Math.max(8, Math.min(speedAt(along), 130)), step = (v / 3.6) * every;
    // frenar: llegar a la parada con velocidad baja
    if (next && next.stop !== false && next.along - along <= step * 1.5) {
      along = next.along; push(8); t += every * 1000; odo += 0;
      wait(next.dwellS ?? 60);
      queue.splice(queue.indexOf(next), 1);
      // arranca: primera muestra moviéndose despacio
      along += 15; push(15); t += every * 1000;
      continue;
    }
    if (next && next.stop === false && next.along <= along + step) queue.splice(queue.indexOf(next), 1);
    along = Math.min(end, along + step); odo += step;
    push(v); t += every * 1000;
  }
  push(0); // llegada
  return out;
}

/** Corta una lista de posiciones dejando una de cada n (simula pérdida de reportes / intervalos largos). */
export const thin = (positions, n) => positions.filter((_, i) => i % n === 0 || i === positions.length - 1);

// ----- ruta de prueba: del norte al sur con curvas, unos 130 km, cuatro paradas
export const TEST_LINE = [[-24.185, -65.300], [-23.80, -65.40], [-23.20, -65.30], [-22.80, -65.50], [-22.10, -65.60]];
