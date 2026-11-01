// Capa de datos de la web. El contenido real vive en la base (se edita desde /admin);
// acá se mezcla con los valores por defecto (src/content/defaults.js) y se expone como "enlaces vivos":
// cuando setContent() reasigna una variable, todos los módulos que la importan ven el valor nuevo.
import { DEFAULT_CONTENT } from "../content/defaults.js";

export const TZ = "America/Argentina/Jujuy";
export const TRUNK = [
  "San Salvador de Jujuy", "Volcán", "Tumbaya", "Purmamarca", "Maimará", "Tilcara",
  "Huacalera", "Humahuaca", "Tres Cruces", "Abra Pampa", "La Quiaca",
];

// ---- utilidades ----
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
export function mergeContent(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = isObj(base[k]) && isObj(over[k]) ? mergeContent(base[k], over[k]) : over[k] === undefined ? base[k] : over[k];
  return out;
}

// ---- contenido vivo ----
export let CONTENT, SITE, TEXTS, HERO, ROUTES, ORIGINS, DESTINATIONS, GALLERY, BOARD_IMAGE, BOLETERIAS, FAQ, SERVICES, JOURNEY;
export let WA_NUMBER, AGENT_ID;

export function setContent(remote) {
  const c = mergeContent(DEFAULT_CONTENT, remote && typeof remote === "object" ? remote : {});
  CONTENT = c;
  SITE = c.site; TEXTS = c.texts; HERO = c.hero; ROUTES = c.routes;
  DESTINATIONS = c.destinations; GALLERY = c.gallery; BOARD_IMAGE = c.boardImage;
  BOLETERIAS = c.boleterias; FAQ = c.faq; SERVICES = c.services; JOURNEY = c.journey;
  WA_NUMBER = c.site.whatsapp; AGENT_ID = c.site.agentId;
  ORIGINS = [...new Set(ROUTES.map((r) => r.from))];
  return c;
}
setContent(null);

// ---- consultas de horarios ----
export const destinationsFor = (origin) => [...new Set(ROUTES.filter((r) => r.from === origin).flatMap((r) => r.stops))];

export function search(origin, dest) {
  const out = [];
  ROUTES.filter((r) => r.from === origin && r.stops.includes(dest)).forEach((r) =>
    r.times.forEach((t) => out.push({ time: t, service: r.service, days: r.days?.[t], note: r.note, route: r.id }))
  );
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export const short = (n) => ({ "San Salvador de Jujuy": "Jujuy" }[n] || n);
