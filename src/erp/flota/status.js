// Ayudantes puros de la flota (sin pantalla): estado de cada coche, antigüedad del último dato, señal, rumbo y tipos de alerta.

export const DEFAULTS = { speedLimit: 90, noSignalMin: 10, delayTolMin: 5, stopRadiusM: 120, idleStopMin: 15, lowVoltage: 11, retentionDays: 30 };
export const settingsOf = (rows) => ({ ...DEFAULTS, ...((rows && rows[0] && rows[0].data) || {}) });

export const STATUS = {
  moving: { label: "En marcha", tone: "ok" },
  idle: { label: "Detenido con motor", tone: "warn" },
  parked: { label: "Apagado", tone: "off" },
  offline: { label: "Sin señal", tone: "bad" },
  nodata: { label: "Sin datos", tone: "off" },
  nodevice: { label: "Sin equipo", tone: "off" },
};

/** Estado de un vehículo a partir de su fila de vehicle_state. `now` en ms. */
export function vehicleStatus(vehicle, state, now = Date.now(), set = DEFAULTS) {
  if (!vehicle.device_id) return "nodevice";
  if (!state || !state.last_time) return "nodata";
  const seen = Math.max(Date.parse(state.last_received || 0) || 0, Date.parse(state.last_time) || 0);
  const stale = now - seen > set.noSignalMin * 60_000;
  if (stale) return "offline";
  if (state.speed >= 5 && state.ignition) return "moving";
  return state.ignition ? "idle" : "parked";
}

/** "hace 12 s", "hace 5 min", "hace 3 h", "hace 2 días". */
export function ago(ms, now = Date.now()) {
  if (!ms) return "nunca";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "ahora";
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d < 60 ? `hace ${d} ${d === 1 ? "día" : "días"}` : `hace ${Math.round(d / 30)} meses`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Barras de señal celular 0-5 a partir de CSQ (0-30; 99 = sin señal). */
export const csqBars = (csq) => (csq == null || csq === 99 || csq <= 0 ? 0 : csq < 6 ? 1 : csq < 11 ? 2 : csq < 16 ? 3 : csq < 21 ? 4 : 5);

/** Duración en minutos como "2 h 05 min" / "35 min" / "45 s". */
export function dur(sec) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export const km = (m, d = 1) => (m == null ? "—" : (m / 1000).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }));

export const ALERTS = {
  exceso_velocidad: { label: "Exceso de velocidad", icon: "velocidad" },
  sentido_contrario: { label: "Sentido contrario", icon: "alert" },
  fuera_de_ruta: { label: "Fuera de ruta", icon: "ruta" },
  parada_omitida: { label: "Parada omitida", icon: "pin" },
  atraso: { label: "Atraso", icon: "historial" },
  sin_senal: { label: "Sin señal", icon: "gps" },
  geocerca_restringida: { label: "Zona prohibida", icon: "geocerca" },
  bateria: { label: "Batería", icon: "bolt" },
  detenido: { label: "Detenido", icon: "pin" },
};
export const SEVERITY = { info: { label: "Información", tone: "off" }, aviso: { label: "Aviso", tone: "warn" }, critica: { label: "Crítica", tone: "bad" } };
export const TRIP_STATUS = { programado: { label: "Programado", tone: "off" }, en_curso: { label: "En curso", tone: "warn" }, completado: { label: "Completado", tone: "ok" }, cancelado: { label: "Cancelado", tone: "off" } };
export const STOP_STATUS = { pendiente: { label: "Pendiente", tone: "off" }, ok: { label: "Frenó", tone: "ok" }, omitida: { label: "No frenó", tone: "bad" } };
export const FENCE_KINDS = { parada: "Parada", terminal: "Terminal", zona: "Zona con límite de velocidad", restringida: "Zona prohibida" };
export const FENCE_COLOR = { parada: "#f4b400", terminal: "#0ea5e9", zona: "#8b5cf6", restringida: "#ef4444" };

/** Fecha y hora cortas en horario de Jujuy. */
const FMT = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Jujuy", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const FMT_T = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Jujuy", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const FMT_D = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Jujuy" }); // yyyy-mm-dd
export const fmtWhen = (iso) => (iso ? FMT.format(new Date(iso)) : "—");
export const fmtTime = (iso) => (iso ? FMT_T.format(new Date(iso)) : "—");
export const fmtHm = (iso) => (iso ? FMT_T.format(new Date(iso)).slice(0, 5) : "—");
export const jujuyDay = (ms = Date.now()) => FMT_D.format(new Date(ms));
/** Medianoche (inicio) de un día "yyyy-mm-dd" de Jujuy, en ISO. */
export const dayStart = (day) => new Date(`${day}T00:00:00-03:00`).toISOString();
export const dayEnd = (day) => new Date(`${day}T23:59:59.999-03:00`).toISOString();

const FMT_FULL = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Jujuy", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const FMT_FULLS = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Jujuy", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
/** "03/11/2026 10:35" (y con segundos si se pide) en horario de Jujuy. */
export const fmtFull = (iso, secs = false) => (iso ? (secs ? FMT_FULLS : FMT_FULL).format(new Date(iso)).replace(",", "") : "");
/** "yyyy-mm-dd" -> "dd/mm/yyyy". */
export const fmtDayEs = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
