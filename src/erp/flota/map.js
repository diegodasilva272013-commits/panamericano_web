// Mapa de la flota (Leaflet, cargado recién cuando se abre una pantalla con mapa para no engordar el resto del ERP).
import { h } from "../../admin/ui.js";
import { FENCE_COLOR } from "./status.js";

let LP = null;
export const loadLeaflet = () => (LP ??= Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]).then(([m]) => m.default || m));

export const BASES = {
  oscuro: { label: "Oscuro", url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", sub: "abcd", attr: "© OpenStreetMap · © CARTO", max: 19 },
  claro: { label: "Claro", url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", sub: "abcd", attr: "© OpenStreetMap · © CARTO", max: 19 },
  satelite: { label: "Satélite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", sub: "", attr: "Imágenes © Esri, Maxar, Earthstar Geographics", max: 18 },
  calles: { label: "Calles", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", sub: "abc", attr: "© OpenStreetMap", max: 19 },
};
export const JUJUY = [-23.6, -65.4];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Marcador de un coche: punto de color según el estado, flecha con el rumbo y una etiqueta con el nombre y la velocidad. */
export function vehicleIcon(L, v, { selected = false } = {}) {
  const cls = `vm vm--${v.status}${selected ? " is-sel" : ""}${v.alert ? " has-alert" : ""}`;
  const moving = v.status === "moving";
  const tag = `<span class="vm__tag"><b>${esc(v.code)}</b>${moving || v.status === "idle" ? `<i>${Math.round(v.speed || 0)} km/h</i>` : ""}</span>`;
  const arrow = v.course != null && v.status !== "offline" ? `<span class="vm__arrow" style="transform:rotate(${Math.round(v.course)}deg)"><svg viewBox="0 0 24 24" width="46" height="46"><path d="M12 1.5 17 9H7z"/></svg></span>` : "";
  return L.divIcon({ className: "vm-wrap", html: `<div class="${cls}">${arrow}<span class="vm__dot"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4" width="15" height="12.5" rx="3"/><path d="M4.5 10.5h15M8 19.5v-3M16 19.5v-3"/></svg></span>${tag}</div>`, iconSize: [46, 46], iconAnchor: [23, 23] });
}

export async function createFleetMap(el, { base = "oscuro", onSelect, center = JUJUY, zoom = 8 } = {}) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.5, zoomDelta: 1, worldCopyJump: false, preferCanvas: false }).setView(center, zoom);
  map.attributionControl.setPrefix(false);
  let tiles = null, baseKey = null;
  const setBase = (k) => {
    if (!BASES[k]) k = "oscuro";
    if (baseKey === k) return;
    tiles?.remove(); const b = BASES[k];
    tiles = L.tileLayer(b.url, { subdomains: b.sub || "abc", attribution: b.attr, maxZoom: b.max, crossOrigin: true }).addTo(map);
    baseKey = k; el.dataset.base = k;
  };
  setBase(base);

  const markers = new Map(), keys = new Map();
  let selectedId = null, following = null;
  const fenceLayer = L.layerGroup(), routeLayer = L.layerGroup();
  let fenceOn = false;

  map.on("zoomstart", () => el.classList.add("is-zooming"));
  map.on("zoomend", () => el.classList.remove("is-zooming"));
  map.on("dragstart", () => { following = null; });

  const api = {
    L, map, setBase, base: () => baseKey,
    zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut(),
    /** Actualiza los coches. list: [{ id, code, lat, lng, course, speed, status, alert }] */
    update(list) {
      const seen = new Set();
      for (const v of list) {
        if (v.lat == null || v.lng == null) continue;
        seen.add(v.id);
        const key = `${v.status}|${Math.round(v.speed || 0)}|${Math.round((v.course || 0) / 5)}|${v.alert ? 1 : 0}|${v.code}|${v.id === selectedId ? 1 : 0}`;
        let m = markers.get(v.id);
        if (!m) { m = L.marker([v.lat, v.lng], { icon: vehicleIcon(L, v, { selected: v.id === selectedId }), keyboard: true, title: v.code, riseOnHover: true, zIndexOffset: 0 }).addTo(map); m.on("click", () => onSelect?.(v.id)); markers.set(v.id, m); keys.set(v.id, key); }
        else {
          if (m.getLatLng().lat !== v.lat || m.getLatLng().lng !== v.lng) m.setLatLng([v.lat, v.lng]);
          if (keys.get(v.id) !== key) { m.setIcon(vehicleIcon(L, v, { selected: v.id === selectedId })); keys.set(v.id, key); }
        }
        m.setZIndexOffset(v.id === selectedId ? 2000 : v.alert ? 1000 : v.status === "moving" ? 500 : 0);
        if (following === v.id) map.panTo([v.lat, v.lng], { animate: true, duration: 0.6 });
      }
      for (const [id, m] of markers) if (!seen.has(id)) { m.remove(); markers.delete(id); keys.delete(id); }
    },
    select(id) { selectedId = id; for (const [k, m] of markers) { const el2 = m.getElement()?.querySelector(".vm"); if (el2) el2.classList.toggle("is-sel", k === id); } },
    follow(id) { following = id; },
    isFollowing: () => following,
    focus(id, z = 14) { const m = markers.get(id); if (m) map.flyTo(m.getLatLng(), Math.max(map.getZoom(), z), { duration: 0.7 }); },
    fit(ids) {
      const pts = [...markers].filter(([id]) => !ids || ids.includes(id)).map(([, m]) => m.getLatLng());
      if (!pts.length) return; if (pts.length === 1) { map.setView(pts[0], 13); return; }
      map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 14 });
    },
    /** Geocercas dibujadas (solo lectura). onClick(fence) opcional. */
    showFences(list, on = true, onClick) {
      fenceLayer.clearLayers(); fenceOn = on;
      if (!on) { fenceLayer.remove(); return; }
      for (const g of list) {
        if (g.active === false) continue;
        const color = g.color || FENCE_COLOR[g.kind] || "#f4b400";
        const opts = { color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: g.kind === "restringida" ? 0.22 : 0.14, interactive: !!onClick || true };
        const layer = g.shape === "polygon" ? L.polygon(g.polygon, opts) : L.circle([g.lat, g.lng], { ...opts, radius: g.radius_m });
        layer.bindTooltip(g.name, { sticky: true, direction: "top", className: "fence-tip" });
        if (onClick) layer.on("click", () => onClick(g));
        fenceLayer.addLayer(layer);
      }
      fenceLayer.addTo(map);
    },
    fenceLayer,
    /** Línea de un recorrido (poligonal [[lat,lng],...]). */
    showRoute(line, { color = "#f4b400" } = {}) {
      routeLayer.clearLayers();
      if (line && line.length > 1) { routeLayer.addLayer(L.polyline(line, { color: "#000", weight: 7, opacity: 0.35 })); routeLayer.addLayer(L.polyline(line, { color, weight: 3.5, opacity: 0.95, dashArray: "1 8", lineCap: "round" })); routeLayer.addTo(map); }
      else routeLayer.remove();
    },
    clearRoute() { routeLayer.clearLayers(); },
    invalidate() { map.invalidateSize(); },
    destroy() { map.remove(); },
  };
  return api;
}

/** Botonera flotante del mapa (zoom, capas, ajustar a todos). */
export function mapTools(api, { onFit, extra = [] } = {}) {
  const b = (label, ico, fn, attrs = {}) => h("button", { type: "button", class: "mt", title: label, "aria-label": label, onclick: fn, ...attrs }, ico);
  const svg = (p) => h("span", { class: "i", html: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>` });
  const bases = h("div", { class: "mt-bases", hidden: true, role: "menu" }, Object.entries(BASES).map(([k, v]) => h("button", { type: "button", role: "menuitemradio", "aria-checked": String(api.base() === k), class: api.base() === k ? "is-on" : "", onclick: () => { api.setBase(k); bases.hidden = true; refresh(); } }, v.label)));
  const refresh = () => bases.querySelectorAll("button").forEach((x, i) => { const on = Object.keys(BASES)[i] === api.base(); x.classList.toggle("is-on", on); x.setAttribute("aria-checked", String(on)); });
  const bar = h("div", { class: "map-tools" },
    b("Acercar", svg('<path d="M12 5v14M5 12h14"/>'), () => api.zoomIn()),
    b("Alejar", svg('<path d="M5 12h14"/>'), () => api.zoomOut()),
    b("Ver toda la flota", svg('<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>'), () => (onFit ? onFit() : api.fit())),
    b("Cambiar el mapa", svg('<path d="m12 4 8.5 4.5L12 13 3.5 8.5zM3.5 12.5 12 17l8.5-4.5"/>'), () => { bases.hidden = !bases.hidden; }),
    ...extra, bases);
  return bar;
}
