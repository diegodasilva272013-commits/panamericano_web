// Un lote puede traer varias versiones de lo mismo (la llegada y la salida de una parada, una alerta que se actualiza en cada reporte).
// Antes de guardar se funden en una sola fila: gana lo más nuevo, y un dato que ya estaba se conserva si la versión nueva no lo trae.
const mergeDefined = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) if (v !== undefined && v !== null) o[k] = v; return o; };

function fold(list, keyOf) {
  const m = new Map();
  for (const x of list) { const k = keyOf(x); const prev = m.get(k); m.set(k, prev ? mergeDefined(prev, x) : { ...x }); }
  return [...m.values()];
}

export function compactBatch(b) {
  return {
    ...b,
    stops: fold(b.stops || [], (s) => `${s.tripId}:${s.idx}`),
    alerts: fold(b.alerts || [], (a) => `${a.vehicleId}:${a.key}`),
    trips: fold(b.trips || [], (t) => t.id),
    state: fold(b.state || [], (s) => s.vehicleId),
  };
}
