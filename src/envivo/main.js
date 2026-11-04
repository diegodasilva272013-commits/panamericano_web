// Panamericano en vivo: dónde vienen los colectivos, para pasajeros.
// Datos públicos: dos funciones de la base (recorridos y viajes en curso). Se actualiza cada 8 segundos.
import { SUPABASE } from "../scripts/config.js";
import { loadContent } from "../scripts/content.js";
import { ROUTES, JOURNEY, runsOn, short } from "../scripts/data.js";
import { buildRoute, tripView, displayAlong, fmtClock, fmtIn, fmtAgo, shortName } from "./model.js";
import { createScene } from "./scene.js";
import { simulate } from "./sim.js";

const POLL_MS = 8000, TZ = "America/Argentina/Jujuy", MINE_KEY = "pm-envivo-parada";
const app = document.getElementById("app");

// ---------------------------------------------------------------- pequeñas herramientas
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
}
const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8-4.3-4.1 5.9-.8z"/>',
  share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 13v6.5h14V13"/>',
  map: '<path d="M9 4.5l-5 2v13l5-2 6 2 5-2v-13l-5 2-6-2zM9 4.5v13M15 6.5v13"/>',
  stops: '<path d="M7 4v16M7 7h.01M7 12h.01M7 17h.01M11 7h8M11 12h8M11 17h6"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/>',
};
const icon = (n, s = 20) => h("span", { class: "ic", "aria-hidden": "true", html: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>` });
const getMine = () => { try { return localStorage.getItem(MINE_KEY) || ""; } catch { return ""; } };
const setMine = (v) => { try { v ? localStorage.setItem(MINE_KEY, v) : localStorage.removeItem(MINE_KEY); } catch { /* sin almacenamiento */ } };
const setText = (n, t) => { if (n.textContent !== t) n.textContent = t; };

async function rpc(fn) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(`${SUPABASE.url}/rest/v1/rpc/${fn}`, { method: "POST", signal: ctl.signal, headers: { apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}`, "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) throw Object.assign(new Error("servicio"), { status: r.status });
    return await r.json();
  } finally { clearTimeout(timer); }
}

// punto del trazado a cierta distancia del inicio (para el mapa)
function pointAt(route, along) {
  const { line, cum } = route; let i = 0;
  while (i < line.length - 2 && cum[i + 1] < along) i++;
  const t = Math.max(0, Math.min(1, (along - cum[i]) / ((cum[i + 1] - cum[i]) || 1)));
  return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
}

// ---------------------------------------------------------------- estado
const S = { routes: new Map(), realRoutes: new Map(), simRoutes: null, trips: [], skew: 0, loaded: false, error: "", lastOk: 0, sim: false };
const now = () => Date.now() + S.skew;
const views = () => S.trips.map((t) => { const r = S.routes.get(t.route_id); return r ? tripView(r, t, now()) : null; }).filter(Boolean);

const toMap = (raw) => { const content = { routes: ROUTES, journey: JOURNEY }; return new Map(raw.map((r) => buildRoute(r, content)).filter(Boolean).map((r) => [r.id, r])); };
// Datos reales de la base. Mientras no haya ningún coche real en viaje (los GPS todavía no están conectados),
// se muestra una simulación con el horario real de la web, siempre avisada como tal. Con el primer coche real, se apaga sola.
async function poll() {
  let real = null;
  if (SUPABASE.url && SUPABASE.anonKey) {
    try {
      if (!S.realRoutes.size || Date.now() - (S.routesAt || 0) > 10 * 60_000) { S.realRoutes = toMap(await rpc("public_routes")); S.routesAt = Date.now(); }
      real = await rpc("public_live"); S.error = "";
    } catch (e) { S.error = e.status === 404 ? "off" : "net"; }
  }
  const realTrips = (real?.trips || []).filter((t) => S.realRoutes.has(t.route_id));
  if (real && realTrips.some((t) => t.status === "en_curso")) {
    S.sim = false; S.routes = S.realRoutes; S.trips = realTrips; S.skew = Date.parse(real.now) - Date.now();
  } else {
    const sim = simulate(ROUTES, Date.now(), runsOn);
    S.simRoutes ??= toMap(sim.routes);
    S.sim = true; S.routes = S.simRoutes; S.trips = sim.live.trips; S.skew = 0; S.error = "";
  }
  S.loaded = true; S.lastOk = Date.now();
  render();
}
let pollTimer = 0;
function startPolling() { clearInterval(pollTimer); poll(); pollTimer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

// ---------------------------------------------------------------- armado general
const statusEl = h("span", { class: "top__live", role: "status" }, h("i"), h("span", {}, "Conectando"));
const shell = h("div", { class: "ev" },
  h("header", { class: "top" },
    h("a", { class: "top__brand", href: "/", "aria-label": "Panamericano, ir a la web" }, h("img", { src: "/img/logo-panamericano-sm.webp", width: 360, height: 252, alt: "Panamericano de Jujuy S.A." })),
    h("span", { class: "top__title" }, "En vivo"), statusEl),
  h("p", { class: "simbar", hidden: true, role: "note" }, h("b", {}, "Simulación"), " · Los coches se mueven según el horario real de la Ruta 9. Los GPS todavía no están conectados: así se va a ver."),
  h("main", { class: "page", id: "main" }));
app.replaceChildren(shell);
const page = shell.querySelector(".page");

function setStatus() {
  const [dot, txt] = statusEl.children;
  if (!S.loaded) return setText(txt, "Conectando");
  if (S.error === "off") { statusEl.dataset.s = "off"; return setText(txt, "No disponible"); }
  shell.querySelector(".simbar").hidden = !S.sim;
  if (S.sim) { statusEl.dataset.s = "sim"; return setText(txt, "Simulación"); }
  if (S.error) { statusEl.dataset.s = "warn"; return setText(txt, "Sin conexión, reintentando"); }
  statusEl.dataset.s = "ok"; setText(txt, `Actualizado ${fmtAgo(Date.now() - S.lastOk) || "recién"}`); void dot;
}

// ---------------------------------------------------------------- inicio: los viajes de ahora
let screen = null;
const wide = matchMedia("(min-width: 1000px)");
function route() {
  const m = /^#\/v\/([\w-]+)/.exec(location.hash);
  if (wide.matches && screen?.split) { screen.select(m ? m[1] : null); render(); return; }
  screen?.destroy?.();
  screen = wide.matches ? splitScreen(m ? m[1] : null) : m ? tripScreen(m[1]) : homeScreen();
  page.replaceChildren(screen.el);
  page.classList.toggle("is-split", !!screen.split);
  if (!screen.split) window.scrollTo(0, 0);
  render();
}
window.addEventListener("hashchange", route);
wide.addEventListener("change", () => { screen?.destroy?.(); screen = null; route(); });

// escritorio: la lista a la izquierda y el viaje elegido a la derecha, sin cambiar de pantalla
function splitScreen(id) {
  let sel = id, detail = null, detailId = null;
  const home = homeScreen({ split: true, selected: () => sel });
  const right = h("div", { class: "split__detail" });
  const el = h("div", { class: "split" }, h("div", { class: "split__list" }, home.el), right);
  return {
    el, split: true,
    select(v) { sel = v; },
    destroy() { home.destroy(); detail?.destroy(); },
    update() {
      home.update();
      const vs = views();
      if (S.loaded && (!sel || !vs.some((v) => v.id === sel))) sel = (vs.find((v) => v.status === "en_curso" && v.freshness === "live") || vs[0])?.id || null;
      if (sel !== detailId) {
        detail?.destroy(); detailId = sel;
        detail = sel ? tripScreen(sel, { embedded: true }) : null;
        right.replaceChildren(detail ? detail.el : h("div", { class: "empty" }, h("strong", {}, "Elegí un viaje de la lista.")));
      }
      detail?.update();
    },
  };
}

function allStops() {
  const names = new Map();
  for (const r of S.routes.values()) for (const s of r.stops) if (!names.has(s.name)) names.set(s.name, s.short);
  return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
}

function homeScreen({ split = false, selected = () => null } = {}) {
  const list = h("div", { class: "trips" }), later = h("section", { class: "later", hidden: true });
  // celular: arriba, la ventanilla del colectivo que más te importa (el próximo a tu parada, o el primero en viaje)
  const feat = split ? null : h("section", { class: "feat", hidden: true });
  let featScene = null, featView = null, featRaf = 0;
  const featName = h("strong"), featMeta = h("span"), featGo = h("a", { class: "feat__go" }, "Ver viaje");
  if (feat) {
    featScene = createScene(feat);
    feat.append(h("div", { class: "feat__card" }, h("div", { class: "feat__t" }, featName, featMeta), featGo));
    const loop = () => { if (featView && !feat.hidden) featScene.frame(now()); featRaf = requestAnimationFrame(loop); };
    featRaf = requestAnimationFrame(loop);
  }
  const mineSel = h("select", { id: "mine", onchange: () => { setMine(mineSel.value); render(); } });
  const el = h("div", { class: "home" }, feat,
    h("section", { class: "hello" },
      h("h1", {}, "¿Dónde viene el colectivo?"),
      h("p", {}, "La ubicación de los coches que están viajando ahora, parada por parada."),
      h("label", { class: "mine", for: "mine" }, icon("star", 18), h("span", {}, "Tu parada"), mineSel)),
    list, later);
  const rows = new Map();
  let stopsKey = "";
  return {
    el,
    destroy() { cancelAnimationFrame(featRaf); featScene?.destroy(); },
    update() {
      const opts = allStops(), k = opts.map((o) => o[0]).join("|");
      if (k !== stopsKey) { stopsKey = k; mineSel.replaceChildren(h("option", { value: "" }, "Elegí la tuya"), ...opts.map(([n, s]) => h("option", { value: n }, s))); }
      mineSel.value = getMine();
      const mine = getMine();
      // con tu parada elegida: primero los que todavía pasan por ella, el que llega antes arriba; los que ya pasaron, al final
      const toMine = (v) => { const i = mine ? v.route.stops.findIndex((s) => s.name === mine) : -1; if (i < 0) return 9e15; if (v.status === "en_curso" && i <= v.passed) return 8e15; const e = v.etas.get(v.route.stops[i].idx); return e && Number.isFinite(e.at) ? e.at : 7e15; };
      const vs = views().sort((a, b) => (mine ? toMine(a) - toMine(b) : 0) || (a.status === "en_curso" ? 0 : 1) - (b.status === "en_curso" ? 0 : 1) || a.planned - b.planned);
      if (feat) {
        const f = vs.find((v) => v.status === "en_curso" && v.freshness !== "none");
        feat.hidden = !f; featView = f || null;
        if (f) {
          featScene.set(f, mine);
          const nx = f.route.stops[f.next], e = nx && f.etas.get(nx.idx);
          setText(featName, `${f.route.name} · ${f.tripTime}`);
          setText(featMeta, nx && f.next > f.passed && e && Number.isFinite(e.at) ? `${f.coach} · ${nx.short} en ${fmtIn(e.at, now())}` : `${f.coach} · ${f.where}`);
          featGo.setAttribute("href", `#/v/${f.id}`);
        }
      }
      if (!S.loaded) { list.replaceChildren(h("p", { class: "empty" }, "Buscando los colectivos…")); return; }
      if (S.error === "off") { list.replaceChildren(h("div", { class: "empty" }, h("strong", {}, "Esta función se está activando."), h("p", {}, "Muy pronto vas a poder ver acá dónde viene cada colectivo."))); return; }
      if (!vs.length) {
        list.replaceChildren(h("div", { class: "empty" }, h("strong", {}, "Ahora no hay colectivos en viaje."), h("p", {}, "Cuando un coche sale, aparece acá y lo ves avanzar parada por parada.")));
        rows.clear();
      } else {
        const seen = new Set();
        for (const v of vs) {
          seen.add(v.id);
          let r = rows.get(v.id);
          if (!r) { r = tripRow(v); rows.set(v.id, r); }
          r.update(v, mine);
          r.el.classList.toggle("is-sel", split && selected() === v.id);
        }
        for (const [id, r] of rows) if (!seen.has(id)) { r.el.remove(); rows.delete(id); }
        const order = vs.map((v) => rows.get(v.id).el);
        if (order.some((n, i) => list.children[i] !== n)) list.replaceChildren(...order);
      }
      paintLater(later, vs);
    },
  };
}

// fila de un viaje: nombre, la línea con sus paradas y el coche, y lo que falta
function tripRow(v) {
  const name = h("strong", { class: "trip__name" }), meta = h("span", { class: "trip__meta" });
  const track = h("div", { class: "strip" }), fill = h("i", { class: "strip__done" }), bus = h("b", { class: "strip__bus" });
  const dots = h("div", { class: "strip__dots" });
  track.append(fill, dots, bus);
  const now1 = h("span", { class: "trip__now" }), nextT = h("strong", { class: "trip__next" }), mineL = h("p", { class: "trip__mine", hidden: true });
  const el = h("a", { class: "trip", href: `#/v/${v.id}` }, h("div", { class: "trip__top" }, name, meta), track, h("p", { class: "trip__line" }, now1, nextT), mineL);
  let built = "";
  return {
    el,
    update(v, mine) {
      const R = v.route.length, n = now();
      setText(name, v.route.name);
      setText(meta, [v.tripTime, v.coach].filter(Boolean).join(" · "));
      const k = v.route.stops.map((s) => s.idx + ":" + (s === undefined)).join() + v.passed + mine;
      if (k !== built) {
        built = k;
        dots.replaceChildren(...v.route.stops.map((s, i) => h("span", { class: "strip__stop" + (i <= v.passed ? " is-passed" : "") + (s.name === mine ? " is-mine" : ""), style: `left:${(s.along / R) * 100}%`, title: s.short })));
      }
      const p = Math.max(0, Math.min(1, displayAlong(v, n) / R));
      fill.style.transform = `scaleX(${p.toFixed(4)})`; bus.style.left = `${p * 100}%`;
      el.dataset.f = v.freshness; el.dataset.st = v.status;
      setText(now1, v.where);
      const nx = v.route.stops[v.next], eta = nx && v.etas.get(nx.idx);
      setText(nextT, v.status === "en_curso" && nx && v.next > v.passed && eta && Number.isFinite(eta.at) ? `${nx.short} ${eta.kind === "horario" ? "≈ " + fmtClock(eta.at) : "en " + fmtIn(eta.at, n)}` : "");
      const ms = mine && v.route.stops.find((s) => s.name === mine), mi = ms && v.route.stops.indexOf(ms);
      if (ms && (v.status !== "en_curso" || mi > v.passed)) {
        const e = v.etas.get(ms.idx);
        mineL.hidden = false;
        setText(mineL, e && Number.isFinite(e.at) ? `Pasa por ${ms.short} ${e.kind === "horario" ? "a las " + fmtClock(e.at) + " (horario)" : "≈ " + fmtClock(e.at) + " · en " + fmtIn(e.at, n)}` : `Pasa por ${ms.short}`);
      } else if (ms) { mineL.hidden = false; setText(mineL, `Ya pasó por ${ms.short}`); el.dataset.gone = "1"; }
      else mineL.hidden = true;
    },
  };
}

// próximas salidas según el horario de la web (cuando no hay viajes cargados, o además de ellos)
function paintLater(box, vs) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(now());
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now());
  const have = new Set(vs.map((v) => v.route.id + "|" + v.tripTime));
  const items = [];
  for (const r of ROUTES || []) for (const t of r.times || []) if (t > hm && !have.has(r.id + "|" + t) && (!r.days?.[t] || runsOn(r.days[t], today))) items.push({ t, r });
  items.sort((a, b) => a.t.localeCompare(b.t));
  const top = items.slice(0, 6);
  box.hidden = !top.length;
  if (!top.length) return;
  box.replaceChildren(h("h2", {}, "Próximas salidas"), h("p", { class: "hint" }, "Según el horario. Se ven en vivo cuando el coche sale."),
    h("ul", { class: "later__list" }, ...top.map(({ t, r }) => h("li", {}, h("b", {}, t), h("span", {}, `${short(r.from)} → ${short(String(r.to).replace(/\*$/, ""))}`), r.via ? h("small", {}, r.via) : null))));
}

// ---------------------------------------------------------------- un viaje: la ventanilla
function tripScreen(id, { embedded = false } = {}) {
  const win = h("div", { class: "win" }), back = h("button", { type: "button", class: "win__back", hidden: true, onclick: () => scene.back() }, "Volver al colectivo");
  const live = h("span", { class: "win__live" }), alt = h("span", { class: "win__alt" });
  win.append(live, alt, back);
  const scene = createScene(win, { onLook: (on) => { back.hidden = !on; } });
  const title = h("h1", { class: "head__t" }), meta = h("p", { class: "head__m" });
  const nowName = h("strong", { class: "now__stop" }), nowIn = h("span", { class: "now__in" }), nowWhere = h("p", { class: "now__where" }), nowNote = h("p", { class: "now__note", hidden: true });
  const stopsList = h("ol", { class: "stops" });
  const mapBox = h("div", { class: "map", hidden: true });
  const tabStops = h("button", { type: "button", class: "tab is-on", "aria-pressed": "true", onclick: () => tab("stops") }, icon("stops", 18), "Paradas");
  const tabMap = h("button", { type: "button", class: "tab", "aria-pressed": "false", onclick: () => tab("map") }, icon("map", 18), "Mapa");
  const shareBtn = h("button", { type: "button", class: "share", onclick: share, "aria-label": "Compartir este viaje" }, icon("share", 18), h("span", { class: "share__t" }, "Compartir"));
  const el = h("div", { class: "trip-v" },
    h("div", { class: "head" }, embedded ? null : h("a", { class: "head__back", href: "#/", "aria-label": "Volver a todos los viajes" }, icon("back", 22)), h("div", {}, title, meta), shareBtn),
    win,
    h("div", { class: "body" },
      h("section", { class: "now", "aria-live": "polite" }, h("p", { class: "now__l" }, "Próxima parada"), h("div", { class: "now__row" }, nowName, nowIn), nowWhere, nowNote),
      h("div", { class: "tabs", role: "group", "aria-label": "Vista" }, tabStops, tabMap),
      stopsList, mapBox),
    h("p", { class: "fine" }, "Los horarios son estimados con el GPS del coche y pueden variar por el tránsito o el clima."));
  let mapApi = null, cur = null, raf = 0, missing = false, stopRows = [], stopsKey = "";
  function tab(k) {
    const m = k === "map";
    tabStops.classList.toggle("is-on", !m); tabMap.classList.toggle("is-on", m); tabStops.setAttribute("aria-pressed", String(!m)); tabMap.setAttribute("aria-pressed", String(m));
    stopsList.hidden = m; mapBox.hidden = !m;
    if (m && !mapApi) import("./map.js").then(({ createMap }) => createMap(mapBox)).then((api) => { mapApi = api; paintMap(); }).catch(() => { mapBox.textContent = "No se pudo cargar el mapa."; });
    else if (m) { mapApi.refresh(); mapApi.recenter(); paintMap(); }
  }
  function paintMap() { if (!mapApi || !cur || (mapBox.hidden && !embedded)) return; mapApi.set(cur, cur.freshness === "none" ? null : pointAt(cur.route, displayAlong(cur, now()))); }
  async function share() {
    const url = location.href, text = cur ? `Mirá dónde viene el colectivo ${cur.route.name} de las ${cur.tripTime}` : "Panamericano en vivo";
    try { if (navigator.share) await navigator.share({ title: "Panamericano en vivo", text, url }); else { await navigator.clipboard.writeText(url); setText(shareBtn.lastChild, "Link copiado"); setTimeout(() => setText(shareBtn.lastChild, "Compartir"), 2200); } } catch { /* cancelado */ }
  }
  if (embedded) import("./map.js").then(({ createMap }) => createMap(mapBox)).then((api) => { mapApi = api; paintMap(); }).catch(() => { mapBox.textContent = "No se pudo cargar el mapa."; });
  function loop(t) { if (cur) scene.frame(now()); raf = requestAnimationFrame(loop); void t; }
  raf = requestAnimationFrame(loop);
  let lastMapPaint = 0;

  return {
    el,
    destroy() { cancelAnimationFrame(raf); scene.destroy(); mapApi?.destroy(); },
    update() {
      const v = views().find((x) => x.id === id);
      if (!v) {
        if (!S.loaded) { setText(title, "Buscando el viaje…"); return; }
        if (!missing) { missing = true; el.replaceChildren(h("div", { class: "empty empty--trip" }, h("strong", {}, "Este viaje ya terminó o no está en curso."), h("p", {}, "Mirá los colectivos que están viajando ahora."), h("a", { class: "btn", href: "#/" }, "Ver los viajes de ahora"))); }
        return;
      }
      cur = v; const n = now(), mine = getMine();
      scene.set(v, mine);
      setText(title, v.route.name);
      setText(meta, [v.status === "en_curso" ? `Salió ${fmtClock(v.started) || v.tripTime}` : `Sale ${v.tripTime}`, v.coach ? `Coche ${v.coach}` : "", v.route.via].filter(Boolean).join(" · "));
      document.title = `${v.route.name} · Panamericano en vivo`;
      // cartel de estado sobre la ventanilla
      setText(live, v.freshness === "live" ? `En vivo · ${fmtAgo(n - v.at)}` : v.freshness === "stale" ? `Última señal ${fmtAgo(n - v.at)}` : v.freshness === "lost" ? `Sin señal desde ${fmtClock(v.at)}` : v.status === "en_curso" ? "Esperando señal" : `Sale ${v.tripTime}`);
      live.dataset.f = v.freshness;
      const a = v.route.profile.known ? Math.round(v.route.profile.alt(displayAlong(v, n)) / 10) * 10 : null;
      alt.hidden = a == null; if (a != null) setText(alt, `≈ ${a.toLocaleString("es-AR")} m de altura`);
      // próxima parada en grande
      const nx = v.route.stops[v.next], e = nx && v.etas.get(nx.idx);
      if (v.status !== "en_curso") { setText(nowName, shortName(v.route.from)); setText(nowIn, `sale ${v.tripTime}`); }
      else if (nx && v.next > v.passed) { setText(nowName, nx.short); setText(nowIn, e && Number.isFinite(e.at) ? (e.kind === "horario" ? `≈ ${fmtClock(e.at)}` : `en ${fmtIn(e.at, n)}`) : ""); }
      else { setText(nowName, v.route.stops.at(-1)?.short || ""); setText(nowIn, "llegó"); }
      setText(nowWhere, v.where);
      const note = v.freshness === "stale" ? "El coche no manda datos hace unos minutos: los horarios son aproximados." : v.freshness === "lost" ? "Perdimos la señal del coche (pasa en zonas sin cobertura). Mostramos la última posición y el horario previsto." : "";
      nowNote.hidden = !note; setText(nowNote, note);
      paintStops(v, mine, n);
      if (performance.now() - lastMapPaint > 2000) { lastMapPaint = performance.now(); paintMap(); }
    },
  };

  function paintStops(v, mine, n) {
    const k = v.route.id + v.route.stops.length;
    if (k !== stopsKey) {
      stopsKey = k;
      stopRows = v.route.stops.map((s) => {
        const time = h("span", { class: "stop__time" }), state = h("span", { class: "stop__state" });
        const star = h("button", { type: "button", class: "stop__mine", "aria-pressed": "false", onclick: () => { setMine(getMine() === s.name ? "" : s.name); render(); } }, icon("star", 18));
        const li = h("li", { class: "stop" }, h("span", { class: "stop__node", "aria-hidden": "true" }), h("div", { class: "stop__txt" }, h("strong", {}, s.short), state), time, star);
        return { s, li, time, state, star };
      });
      stopsList.replaceChildren(...stopRows.map((r) => r.li));
    }
    stopRows.forEach(({ s, li, time, state, star }, i) => {
      const e = v.etas.get(s.idx), passed = i <= v.passed, isNext = v.status === "en_curso" && i === v.next && !passed, isMine = s.name === mine;
      li.classList.toggle("is-passed", passed); li.classList.toggle("is-next", isNext); li.classList.toggle("is-mine", isMine);
      star.setAttribute("aria-pressed", String(isMine)); star.setAttribute("aria-label", isMine ? `Quitar ${s.short} como tu parada` : `Marcar ${s.short} como tu parada`);
      if (e?.kind === "omitida") { setText(time, ""); setText(state, "No paró"); }
      else if (e?.kind === "hecho") { setText(time, fmtClock(e.at)); setText(state, "Pasó"); }
      else if (passed) { setText(time, ""); setText(state, "Pasó"); }
      else if (e && Number.isFinite(e.at)) { setText(time, (e.kind === "estimado" ? "" : "≈ ") + fmtClock(e.at)); setText(state, e.kind === "horario" ? "Horario previsto" : `En ${fmtIn(e.at, n)}${e.kind === "aprox" ? " (aprox.)" : ""}`); }
      else { setText(time, ""); setText(state, isNext ? "Próxima" : ""); }
    });
  }
}

// ---------------------------------------------------------------- refresco de pantalla (cada segundo, y al llegar datos)
function render() { setStatus(); screen?.update(); }
setInterval(render, 1000);

// ---------------------------------------------------------------- arranque
(async () => {
  route();
  if (SUPABASE.url && SUPABASE.anonKey) await loadContent(1500);
  startPolling();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw-envivo.js", { scope: "/envivo" }).catch(() => {});
})();
