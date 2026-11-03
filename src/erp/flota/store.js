// Datos de la flota compartidos por todas las pantallas de Flota, con avisos de cambios (para el mapa en vivo y las insignias).
import { loadFleet } from "./data.js";

let F = null, loading = null;
const subs = new Set();
const notify = (what) => subs.forEach((fn) => { try { fn(what, F); } catch (e) { console.error(e); } });

export const OPEN_WINDOW_MS = 48 * 3600_000;
/** Alertas pendientes de atender: no atendidas y de las últimas 48 horas. */
export const openAlerts = (f = F) => (f ? f.alerts.filter((a) => !a.ack_at && Date.now() - Date.parse(a.started_at) < OPEN_WINDOW_MS) : []);

export const fleet = {
  get: () => F,
  /** Devuelve los datos; si todavía no se cargaron, los carga una sola vez aunque se pida varias veces a la vez. */
  async ensure() {
    if (F) return F;
    loading ??= loadFleet().then((x) => { F = x; notify("load"); return x; }).finally(() => { loading = null; });
    return loading;
  },
  async reload() { loading = null; F = await loadFleet(); notify("load"); return F; },
  clear() { F = null; },
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  /** Aplica filas nuevas de vehicle_state (en vivo o por consulta). */
  patchStates(rows) {
    if (!F) return;
    for (const r of rows) { const old = F.stateById.get(r.vehicle_id); if (old && old.last_time && r.last_time && Date.parse(r.last_time) < Date.parse(old.last_time)) continue; F.stateById.set(r.vehicle_id, r); }
    F.states = [...F.stateById.values()]; notify("states");
  },
  /** Mezcla alertas nuevas o actualizadas. Devuelve las que no se conocían (para avisar). */
  patchAlerts(rows) {
    if (!F) return [];
    const known = new Map(F.alerts.map((a) => [a.id, a])), fresh = [];
    for (const r of rows) { if (!known.has(r.id)) fresh.push(r); known.set(r.id, { ...(known.get(r.id) || {}), ...r }); }
    F.alerts = [...known.values()].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 800);
    notify("alerts"); return fresh;
  },
  patchAlert(id, patch) { if (!F) return; const a = F.alerts.find((x) => x.id === id); if (a) Object.assign(a, patch); notify("alerts"); },
};
