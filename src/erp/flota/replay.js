// Recorrido de un coche: línea coloreada por velocidad, repetición con velocidades, gráfico de velocidad, detenciones y geocercas.
import { h, icon, toast, plainErr } from "../../admin/ui.js";
import { createFleetMap, mapTools, vehicleIcon } from "./map.js";
import { fetchPositions, fetchGeofenceEvents } from "./data.js";
import { summarize, speedRuns, downsampleMax } from "./track.js";
import { dayStart, dayEnd, jujuyDay, fmtTime, fmtHm, dur, km, compass } from "./status.js";

const RUN_COLOR = { stop: "#8a8678", ok: "#f4b400", fast: "#ff8a1f", over: "#ef4444" };
const SPEEDS = [[10, "10×"], [30, "30×"], [60, "60×"], [120, "120×"], [300, "300×"], [900, "900×"]];

export function openReplay(ctx, F, opts = {}) {
  const back = document.activeElement;
  const set = F.settings;
  let vehicleId = opts.vehicleId || F.vehicles.find((v) => F.stateById.get(v.id))?.id || F.vehicles[0]?.id;
  let positions = [], summary = null, api = null, marker = null, raf = 0, last = 0, vt = 0, mul = 60, playing = false, t0 = 0, t1 = 0, idx = 0, loadSeq = 0;

  // ---- formulario
  const vehSel = h("select", { id: "rp-v", "aria-label": "Coche" }, F.vehicles.map((v) => h("option", { value: v.id, selected: v.id === vehicleId ? true : null }, v.code + (v.plate ? ` · ${v.plate}` : ""))));
  const dayIn = h("input", { type: "date", id: "rp-d", value: opts.day || F.today, max: F.today, "aria-label": "Día" });
  const fromIn = h("input", { type: "time", id: "rp-f", value: opts.from || "00:00", "aria-label": "Desde" });
  const toIn = h("input", { type: "time", id: "rp-t", value: opts.to || "23:59", "aria-label": "Hasta" });
  const go = h("button", { type: "button", class: "btn", onclick: () => load() }, "Ver recorrido");
  const status = h("p", { class: "rp__status", role: "status" });

  // ---- paneles
  const mapEl = h("div", { class: "rp__map" });
  const cards = h("div", { class: "rp__stats" });
  const stopsEl = h("div", { class: "rp__list" });
  const evEl = h("div", { class: "rp__list" });
  const playBtn = h("button", { type: "button", class: "rp__play", "aria-label": "Reproducir", onclick: () => toggle() }, icon("play", 20));
  const slider = h("input", { type: "range", min: "0", max: "1000", value: "0", class: "rp__slider", "aria-label": "Posición en el recorrido", oninput: (e) => seek(Number(e.target.value) / 1000) });
  const speedSel = h("select", { class: "rp__speed", "aria-label": "Velocidad de la repetición", onchange: (e) => { mul = Number(e.target.value); } }, SPEEDS.map(([v, l]) => h("option", { value: v, selected: v === mul ? true : null }, l)));
  const clock = h("span", { class: "rp__clock" }, "—");
  const now = h("div", { class: "rp__now" });
  const canvas = h("canvas", { class: "rp__chart", height: "96", "aria-label": "Velocidad a lo largo del recorrido" });
  canvas.addEventListener("click", (e) => { const r = canvas.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); });

  const close = () => { cancelAnimationFrame(raf); document.removeEventListener("keydown", key, true); api?.destroy(); ov.remove(); document.body.classList.remove("no-scroll"); back?.focus?.(); };
  const key = (e) => {
    if (document.querySelector(".modal")) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === " " && !/INPUT|SELECT|BUTTON|TEXTAREA/.test(document.activeElement?.tagName || "")) { e.preventDefault(); toggle(); }
    else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && document.activeElement === document.body) { vt = Math.max(0, Math.min(t1 - t0, vt + (e.key === "ArrowRight" ? 60_000 : -60_000))); render(); }
  };

  const panel = h("div", { class: "rp__panel", role: "dialog", "aria-modal": "true", "aria-label": "Recorrido de un coche" },
    h("header", { class: "rp__head" },
      h("div", { class: "rp__title" }, icon("ruta", 22), h("h2", {}, "Recorrido")),
      h("div", { class: "rp__form" },
        h("label", {}, h("span", {}, "Coche"), vehSel), h("label", {}, h("span", {}, "Día"), dayIn), h("label", {}, h("span", {}, "Desde"), fromIn), h("label", {}, h("span", {}, "Hasta"), toIn), go),
      h("button", { type: "button", class: "ico rp__x", "aria-label": "Cerrar", onclick: close }, icon("x", 22))),
    status,
    h("div", { class: "rp__body" },
      h("div", { class: "rp__mapbox" }, mapEl, now),
      h("aside", { class: "rp__side" }, cards, h("h3", {}, "Detenciones"), stopsEl, h("h3", {}, "Geocercas"), evEl)),
    h("footer", { class: "rp__bar" },
      h("div", { class: "rp__ctl" }, playBtn, slider, clock, speedSel),
      canvas));
  const ov = h("div", { class: "rp" }, panel);
  document.addEventListener("keydown", key, true); document.body.append(ov); document.body.classList.add("no-scroll");

  const setStatus = (t, tone = "") => { status.textContent = t || ""; status.className = "rp__status" + (tone ? " is-" + tone : ""); };

  // ---- carga
  async function load() {
    const seq = ++loadSeq;
    stop(); vehicleId = vehSel.value;
    const day = dayIn.value || F.today;
    const a = new Date(`${day}T${fromIn.value || "00:00"}:00-03:00`).toISOString(), b = new Date(`${day}T${toIn.value || "23:59"}:59-03:00`).toISOString();
    if (a >= b) { setStatus("La hora «Hasta» tiene que ser posterior a «Desde».", "bad"); return; }
    go.disabled = true; setStatus("Cargando el recorrido…");
    try {
      const [pos, ev] = await Promise.all([fetchPositions(vehicleId, a, b, { onPage: (acc) => { if (seq === loadSeq) setStatus(`Cargando el recorrido… ${acc.length.toLocaleString("es-AR")} posiciones`); } }), fetchGeofenceEvents(vehicleId, a, b)]);
      if (seq !== loadSeq) return;
      positions = pos; summary = summarize(pos, { limit: set.speedLimit });
      await draw(ev);
      setStatus(pos.length ? "" : "Ese coche no tiene posiciones en ese horario.", pos.length ? "" : "warn");
    } catch (e) { if (seq === loadSeq) setStatus(plainErr(e), "bad"); }
    finally { if (seq === loadSeq) go.disabled = false; }
  }

  async function draw(events) {
    if (!api) { api = await createFleetMap(mapEl, { base: "oscuro", zoom: 9 }); mapEl.parentElement.append(mapTools(api, { onFit: fitAll })); }
    const L = api.L;
    if (api.trackLayer) api.trackLayer.clearLayers(); else api.trackLayer = L.layerGroup().addTo(api.map);
    marker?.remove(); marker = null;
    const n = positions.length;
    cards.replaceChildren(); stopsEl.replaceChildren(); evEl.replaceChildren();
    if (!n) { cancelAnimationFrame(raf); drawChart(); render(); return; }
    for (const r of speedRuns(positions, set.speedLimit)) {
      api.trackLayer.addLayer(L.polyline(r.pts, { color: "#000", weight: 7, opacity: 0.4, lineCap: "round", lineJoin: "round" }));
      api.trackLayer.addLayer(L.polyline(r.pts, { color: RUN_COLOR[r.cls], weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }));
    }
    const dot = (cls, txt) => L.divIcon({ className: "rp-pin-wrap", html: `<span class="rp-pin ${cls}">${txt}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    api.trackLayer.addLayer(L.marker([positions[0].lat, positions[0].lng], { icon: dot("is-start", "S"), title: "Salida" }));
    api.trackLayer.addLayer(L.marker([positions[n - 1].lat, positions[n - 1].lng], { icon: dot("is-end", "L"), title: "Última posición" }));
    summary.stops.forEach((s, k) => api.trackLayer.addLayer(L.marker([s.lat, s.lng], { icon: dot("is-stop", String(k + 1)), title: `Detención de ${dur(s.seconds)}` })));
    const first = positions[0], lastp = positions[n - 1];
    t0 = Date.parse(first.event_time); t1 = Date.parse(lastp.event_time); vt = 0; idx = 0;
    marker = L.marker([first.lat, first.lng], { icon: vehicleIcon(L, { code: F.vehicleById.get(vehicleId)?.code || "", status: "moving", course: first.course, speed: first.speed }), zIndexOffset: 3000, interactive: false }).addTo(api.map);
    fitAll();

    // resumen
    const S = summary;
    const card = (l, v, tone) => h("div", { class: "rp__card" + (tone ? " is-" + tone : "") }, h("span", {}, l), h("strong", {}, v));
    cards.append(
      card("Distancia", `${km(S.distanceM)} km`), card("Velocidad máxima", `${S.maxSpeed} km/h`, S.maxSpeed > set.speedLimit ? "bad" : ""), card("Velocidad en marcha", `${S.avgMovingSpeed} km/h`),
      card("En marcha", dur(S.movingS)), card("Detenido con motor", dur(S.idleS)), card("Motor apagado", dur(S.offS)),
      card("Sobre el límite", S.overLimitS ? dur(S.overLimitS) : "ninguno", S.overLimitS ? "bad" : ""), card("Posiciones", n.toLocaleString("es-AR")));
    stopsEl.append(...(S.stops.length ? S.stops.map((s, k) => h("button", { type: "button", class: "rp__row", onclick: () => api.map.flyTo([s.lat, s.lng], 16, { duration: 0.6 }) },
      h("b", {}, String(k + 1)), h("span", {}, `${fmtHm(s.start)} → ${fmtHm(s.end)}`), h("em", {}, dur(s.seconds)), h("small", {}, s.ignition ? "motor encendido" : "motor apagado"))) : [h("p", { class: "empty" }, "Sin detenciones de 2 minutos o más.")]));
    evEl.append(...(events.length ? events.map((e) => { const g = F.fenceById.get(e.geofence_id); return h("div", { class: "rp__row rp__row--ev" }, h("b", { class: e.kind === "entra" ? "in" : "out" }, e.kind === "entra" ? "Entra" : "Sale"), h("span", {}, g?.name || "Geocerca"), h("em", {}, fmtHm(e.at))); }) : [h("p", { class: "empty" }, "No pasó por ninguna geocerca.")]));
    drawChart(); render();
  }

  const fitAll = () => { if (!positions.length) return; api.map.fitBounds(api.L.latLngBounds(positions.map((p) => [p.lat, p.lng])), { padding: [50, 50], maxZoom: 16 }); };

  // ---- gráfico de velocidad
  function drawChart() {
    const ctx2 = canvas.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(280, canvas.clientWidth || 600), H = 96;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, W, H);
    if (!positions.length) return;
    const pts = downsampleMax(positions.map((p) => p.speed || 0), Math.min(W, 600));
    const maxV = Math.max(set.speedLimit + 10, ...pts.map((p) => p.v)), x = (i) => (i / Math.max(1, positions.length - 1)) * (W - 8) + 4, y = (v) => H - 14 - (v / maxV) * (H - 24);
    ctx2.fillStyle = "rgba(244,180,0,.16)"; ctx2.strokeStyle = "#f4b400"; ctx2.lineWidth = 1.6;
    ctx2.beginPath(); ctx2.moveTo(x(0), y(0)); pts.forEach((p) => ctx2.lineTo(x(p.i), y(p.v))); ctx2.lineTo(x(positions.length - 1), y(0)); ctx2.closePath(); ctx2.fill();
    ctx2.beginPath(); pts.forEach((p, k) => (k ? ctx2.lineTo(x(p.i), y(p.v)) : ctx2.moveTo(x(p.i), y(p.v)))); ctx2.stroke();
    ctx2.setLineDash([4, 4]); ctx2.strokeStyle = "#ef4444"; ctx2.beginPath(); ctx2.moveTo(0, y(set.speedLimit)); ctx2.lineTo(W, y(set.speedLimit)); ctx2.stroke(); ctx2.setLineDash([]);
    ctx2.fillStyle = "#9d988a"; ctx2.font = "600 11px system-ui,sans-serif"; ctx2.fillText(`${set.speedLimit} km/h`, 6, y(set.speedLimit) - 4);
    canvas._geom = { W, H, x, y, maxV };
    cursor();
  }
  function cursor() {
    const g = canvas._geom; if (!g || !positions.length) return;
    const c = canvas.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.save(); c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(g.x(idx), 2); c.lineTo(g.x(idx), g.H - 12); c.stroke(); c.restore();
  }

  // ---- repetición
  const at = (ms) => { let lo = 0, hi = positions.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (Date.parse(positions[m].event_time) <= ms) lo = m; else hi = m - 1; } return lo; };
  function render() {
    if (!positions.length) { clock.textContent = "—"; now.replaceChildren(); return; }
    idx = at(t0 + vt);
    const p = positions[idx], q = positions[Math.min(idx + 1, positions.length - 1)];
    const a = Date.parse(p.event_time), b = Date.parse(q.event_time), f = b > a ? Math.max(0, Math.min(1, (t0 + vt - a) / (b - a))) : 0;
    const lat = p.lat + (q.lat - p.lat) * f, lng = p.lng + (q.lng - p.lng) * f;
    marker?.setLatLng([lat, lng]);
    const ik = `${p.speed || 0}|${Math.round((p.course || 0) / 10)}|${p.ignition ? 1 : 0}`;
    if (marker && ik !== iconKey) { iconKey = ik; marker.setIcon(vehicleIcon(api.L, { code: F.vehicleById.get(vehicleId)?.code || "", status: (p.speed || 0) >= 5 ? "moving" : p.ignition ? "idle" : "parked", course: p.course, speed: p.speed })); }
    if (playing && api && !api.map.getBounds().pad(-0.15).contains([lat, lng])) api.map.panTo([lat, lng], { animate: true, duration: 0.4 });
    slider.value = String(Math.round((vt / Math.max(1, t1 - t0)) * 1000));
    clock.textContent = fmtTime(new Date(t0 + vt).toISOString());
    now.replaceChildren(h("strong", {}, `${p.speed || 0} km/h`), h("span", {}, `Rumbo ${compass(p.course || 0)} · ${p.ignition ? "motor encendido" : "motor apagado"}`));
    drawChartFast();
  }
  let iconKey = "";
  const drawChartFast = () => drawChart();
  const tick = (ts) => {
    if (!playing) return;
    if (!last) last = ts;
    vt += (ts - last) * mul; last = ts;
    if (vt >= t1 - t0) { vt = t1 - t0; playing = false; playBtn.replaceChildren(icon("play", 20)); render(); return; }
    render(); raf = requestAnimationFrame(tick);
  };
  function toggle() {
    if (!positions.length) return;
    if (playing) return stop();
    if (vt >= t1 - t0) vt = 0;
    playing = true; last = 0; playBtn.replaceChildren(icon("pause", 20)); playBtn.setAttribute("aria-label", "Pausar"); raf = requestAnimationFrame(tick);
  }
  function stop() { playing = false; cancelAnimationFrame(raf); playBtn.replaceChildren(icon("play", 20)); playBtn.setAttribute("aria-label", "Reproducir"); }
  function seek(f) { vt = Math.max(0, Math.min(1, f)) * (t1 - t0); render(); }
  window.addEventListener("resize", () => { if (ov.isConnected) drawChart(); });

  panel.querySelector(".rp__x").focus();
  if (vehicleId) load();
  else setStatus("Primero cargá un coche en Vehículos.", "warn");
  return { close, load };
}
