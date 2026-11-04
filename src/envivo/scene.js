// La ventanilla: el camino con su altura real, los cerros en capas y el coche de costado.
// El coche queda quieto en pantalla y el paisaje pasa; arrastrando se mira hacia adelante o hacia atrás.
import { displayAlong, fmtIn } from "./model.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.append(n); return n; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// cielo y tierra según la hora en Jujuy
const PHASES = {
  noche: { sky: ["#07080d", "#191826"], far: "#24232f", mid: ["#3a2c2a", "#2c2522"], near: "#1f1915", gnd: ["#211b16", "#0d0b09"], plant: "#070605", ground: "#15120f", road: "#0a0908", line: "rgba(236,232,222,.5)", text: "#ece8de", stars: true, lights: true },
  alba: { sky: ["#3a2a4a", "#e8834a"], far: "#6d5466", mid: ["#8c4a36", "#5e3a2c"], near: "#4a3226", gnd: ["#4a3828", "#21190f"], plant: "#1a130d", ground: "#2e241c", road: "#14110e", line: "rgba(236,232,222,.65)", text: "#fff6ea", stars: false, lights: true },
  dia: { sky: ["#8fb8d6", "#e9e2cf"], far: "#b3a7a3", mid: ["#b7643d", "#8a6a45"], near: "#8e5a3a", gnd: ["#a88a5f", "#5e4630"], plant: "#3f4a2a", ground: "#5e4b36", road: "#24201c", line: "rgba(236,232,222,.85)", text: "#1c1813", stars: false, lights: false },
  tarde: { sky: ["#2d2547", "#f08a4b"], far: "#7a5466", mid: ["#9a4632", "#5c3a2a"], near: "#47291f", gnd: ["#4a3324", "#1d150e"], plant: "#160f0a", ground: "#2b2219", road: "#13100d", line: "rgba(236,232,222,.65)", text: "#fff6ea", stars: false, lights: true },
};
export function phaseAt(now) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Jujuy", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":").map(Number);
  const t = h + m / 60;
  return t < 6 || t >= 20.5 ? "noche" : t < 8 ? "alba" : t < 18.5 ? "dia" : "tarde";
}

// cerros: suma de ondas (siempre iguales para el mismo lugar del recorrido, así el paisaje no "salta")
const ridge = (u, seed) => Math.sin(u / 2300 + seed) * 0.5 + Math.sin(u / 870 + seed * 2.1) * 0.3 + Math.sin(u / 310 + seed * 3.7) * 0.14 + Math.sin(u / 130 + seed * 5.3) * 0.06;

export function createScene(host, { onLook } = {}) {
  const svg = el("svg", { class: "win__svg", role: "img", "aria-label": "Dibujo de la ruta con el colectivo" });
  host.append(svg);
  const defs = el("defs", {}, svg);
  const skyG = el("linearGradient", { id: "evSky", x1: 0, y1: 0, x2: 0, y2: 1 }, defs); const s0 = el("stop", { offset: "0" }, skyG), s1 = el("stop", { offset: "1" }, skyG);
  const midG = el("linearGradient", { id: "evMid", x1: 0, y1: 0, x2: 0, y2: 1 }, defs); const m0 = el("stop", { offset: "0" }, midG), m1 = el("stop", { offset: "1" }, midG);
  const gndG = el("linearGradient", { id: "evGnd", x1: 0, y1: 0, x2: 0, y2: 1 }, defs); const g0 = el("stop", { offset: "0" }, gndG), g1 = el("stop", { offset: "1" }, gndG);
  const beamG = el("linearGradient", { id: "evBeam", x1: 0, y1: 0, x2: 1, y2: 0 }, defs); el("stop", { offset: "0", "stop-color": "#fff3c8", "stop-opacity": ".55" }, beamG); el("stop", { offset: "1", "stop-color": "#fff3c8", "stop-opacity": "0" }, beamG);
  const sky = el("rect", { x: 0, y: 0, fill: "url(#evSky)" }, svg);
  const stars = el("g", { class: "win__stars" }, svg);
  const far = el("path", {}, svg), mid = el("path", { fill: "url(#evMid)" }, svg);
  const near = el("path", {}, svg);
  const ground = el("path", { fill: "url(#evGnd)" }, svg), road = el("path", { fill: "none", "stroke-linecap": "round" }, svg);
  const lane = el("path", { fill: "none", "stroke-dasharray": "10 12" }, svg), done = el("path", { fill: "none", stroke: "#e8261f", "stroke-linecap": "round" }, svg);
  const fore = el("g", { class: "win__fore" }, svg);
  const ticks = el("g", { class: "win__ticks" }, svg), signs = el("g", { class: "win__signs" }, svg);
  const busG = el("g", { class: "win__bus" }, svg);
  const edge = el("g", { class: "win__edge" }, svg);
  drawBus(busG);
  const beam = busG.querySelector(".bus__beam"), wheels = [...busG.querySelectorAll(".bus__spokes")], tag = busG.querySelector(".bus__tag text"), tagBox = busG.querySelector(".bus__tag rect");

  let W = 0, H = 0, view = null, disp = null, look = 0, dragging = null, lastNow = 0, returnAt = 0, phase = "", mine = "";
  const ro = new ResizeObserver(() => { const r = host.getBoundingClientRect(); W = Math.round(r.width); H = Math.round(r.height); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); sky.setAttribute("width", W); sky.setAttribute("height", H); paintStars(); });
  ro.observe(host);

  function paintStars() {
    stars.replaceChildren();
    for (let i = 0; i < 46; i++) { const x = (i * 97.3) % (W || 1), y = ((i * 53.7) % 1) * 0 + ((i * 41) % Math.max(1, Math.round(H * 0.42))); el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: i % 7 ? 0.7 : 1.2, fill: "#ece8de", opacity: i % 3 ? 0.5 : 0.85 }, stars); }
  }
  function setPhase(p) {
    if (p === phase) return; phase = p; const c = PHASES[p];
    s0.setAttribute("stop-color", c.sky[0]); s1.setAttribute("stop-color", c.sky[1]); m0.setAttribute("stop-color", c.mid[0]); m1.setAttribute("stop-color", c.mid[1]);
    far.setAttribute("fill", c.far); near.setAttribute("fill", c.near); g0.setAttribute("stop-color", c.gnd[0]); g1.setAttribute("stop-color", c.gnd[1]); fore.setAttribute("fill", c.plant); road.setAttribute("stroke", c.road); lane.setAttribute("stroke", c.line);
    stars.style.display = c.stars ? "" : "none"; beam.style.display = c.lights ? "" : "none"; svg.dataset.phase = p;
  }

  // escala: metros por pixel; el coche queda a 40% del ancho para ver más camino por delante
  const span = () => Math.max(3500, Math.min(14000, W * 11));
  const busX = () => W * 0.4;

  function frame(now) {
    if (!view || !W) return;
    const dt = lastNow ? Math.min(0.25, (now - lastNow) / 1000) : 0; lastNow = now;
    const target = displayAlong(view, now);
    if (disp == null || Math.abs(target - disp) > 2500 || reduce()) disp = target; else disp += (target - disp) * Math.min(1, dt * 2.5);
    if (!dragging && look && now > returnAt) { look += (0 - look) * Math.min(1, dt * 3); if (Math.abs(look) < 5) { look = 0; onLook?.(false); } }
    setPhase(phaseAt(now));
    const route = view.route, R = route.length, k = W / span(), bx = busX();
    const cx = Math.max(-span() * 0.3, Math.min(R + span() * 0.3, disp + look));
    const X = (a) => bx + (a - cx) * k;
    const A = (x) => cx + (x - bx) / k;
    const prof = route.profile;
    const top = H * 0.5, bottom = H * 0.7;
    const Y = (a) => (prof.known && prof.hi > prof.lo ? bottom - ((prof.alt(Math.max(0, Math.min(R, a))) - prof.lo) / (prof.hi - prof.lo)) * (bottom - top) : H * 0.66);
    const step = Math.max(4, Math.round(W / 90));

    // capas con paralaje: lo lejano se mueve menos
    let dF = `M0 ${H}`, dM = `M0 ${H}`, dN = `M0 ${H}`, dG = `M0 ${H}`, dR = "";
    for (let x = 0; x <= W + step; x += step) {
      const a = A(x), yRoad = Y(a);
      const yFar = H * 0.36 - (ridge(cx * 0.12 + (x - bx) / k, 1.3) + 1) * H * 0.11;
      const yMid = Math.min(yRoad - 10, H * 0.52 - (ridge(cx * 0.45 + (x - bx) / k, 4.1) + 1) * H * 0.13 + (yRoad - H * 0.66) * 0.55);
      const yNear = Math.min(yRoad - 4, yRoad - 18 - (ridge(cx * 0.72 + (x - bx) / k, 7.7) + 1) * H * 0.06);
      dN += ` L${x} ${yNear.toFixed(1)}`;
      dF += ` L${x} ${yFar.toFixed(1)}`; dM += ` L${x} ${yMid.toFixed(1)}`; dG += ` L${x} ${(yRoad + 3).toFixed(1)}`; dR += `${dR ? " L" : "M"}${x} ${yRoad.toFixed(1)}`;
    }
    far.setAttribute("d", dF + ` L${W + step} ${H} Z`); mid.setAttribute("d", dM + ` L${W + step} ${H} Z`); near.setAttribute("d", dN + ` L${W + step} ${H} Z`); ground.setAttribute("d", dG + ` L${W + step} ${H} Z`);
    const rw = Math.max(7, H * 0.028);
    road.setAttribute("d", dR); road.setAttribute("stroke-width", rw);
    lane.setAttribute("d", dR); lane.setAttribute("stroke-width", 1.4);
    // lo ya recorrido en rojo
    let dD = ""; const endX = Math.min(W, X(disp));
    for (let x = Math.max(0, X(0)); x <= endX; x += step) dD += `${dD ? " L" : "M"}${x} ${Y(A(x)).toFixed(1)}`;
    if (dD) dD += ` L${endX} ${Y(A(endX)).toFixed(1)}`;
    done.setAttribute("d", dD); done.setAttribute("stroke-width", Math.max(3, rw * 0.42));

    // primer plano: pasa más rápido que el camino (se siente la velocidad). Cardones entre 1.800 y 3.300 m, paja brava más arriba.
    const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    const G = 140, i0 = Math.floor((cx * 1.0 - bx / k) / G) - 2, i1 = Math.ceil((cx * 1.9 + (W - bx) / k) / G) + 2;
    let fg = "";
    const items = [];
    for (let i = i0; i <= i1; i++) {
      if (hash(i) < 0.42) continue;
      const f = hash(i + 0.37), fac = 1 + 0.9 * f, x = bx + (i * G - cx * fac) * k;
      if (x < -60 || x > W + 60) continue;
      const aw = A(x), yr = Y(aw) + rw / 2 + 4, y = yr + 6 + f * (H - yr - 14);
      items.push({ x, y, f, i, alt: prof.known ? prof.alt(Math.max(0, Math.min(R, aw))) : 2400 });
    }
    items.sort((p, q) => p.y - q.y);
    for (const it of items) {
      const sz = (0.45 + 0.75 * it.f) * Math.max(0.7, H / 360);
      if (it.alt > 1800 && it.alt < 3300 && hash(it.i + 0.71) > 0.25) {
        const hgt = (26 + hash(it.i + 0.13) * 34) * sz, w = 5.5 * sz, arm = hash(it.i + 0.53);
        let d = `M${(it.x - w / 2).toFixed(1)} ${it.y.toFixed(1)}v${(-hgt + w / 2).toFixed(1)}a${(w / 2).toFixed(1)} ${(w / 2).toFixed(1)} 0 0 1 ${w.toFixed(1)} 0v${(hgt - w / 2).toFixed(1)}z`;
        if (arm > 0.3) { const ay = it.y - hgt * (0.35 + arm * 0.2), al = hgt * 0.42; d += `M${(it.x + w / 2).toFixed(1)} ${ay.toFixed(1)}h${(w * 1.3).toFixed(1)}v${(-al + w / 2).toFixed(1)}a${(w / 2).toFixed(1)} ${(w / 2).toFixed(1)} 0 0 0 ${(-w).toFixed(1)} 0v${(al - w / 2 - w * 0.9).toFixed(1)}h${(-w * 0.3).toFixed(1)}z`; }
        if (arm > 0.65) { const ay = it.y - hgt * 0.3, al = hgt * 0.32; d += `M${(it.x - w / 2).toFixed(1)} ${ay.toFixed(1)}h${(-w * 1.2).toFixed(1)}v${(-al + w / 2).toFixed(1)}a${(w / 2).toFixed(1)} ${(w / 2).toFixed(1)} 0 0 1 ${w.toFixed(1)} 0v${(al - w / 2 - w * 0.9).toFixed(1)}h${(w * 0.2).toFixed(1)}z`; }
        fg += `<path d="${d}"/>`;
      } else {
        const r = (7 + hash(it.i + 0.29) * 8) * sz;
        fg += `<path d="M${(it.x - r).toFixed(1)} ${it.y.toFixed(1)}q${(r * 0.2).toFixed(1)} ${(-r * 1.3).toFixed(1)} ${r.toFixed(1)} ${(-r * 1.15).toFixed(1)}q${(r * 0.8).toFixed(1)} ${(-r * 0.15).toFixed(1)} ${r.toFixed(1)} ${(r * 1.15).toFixed(1)}z" opacity=".85"/>`;
      }
    }
    fore.innerHTML = fg;

    // mojones cada kilómetro y cartel cada 5
    let tk = "";
    const k0 = Math.max(0, Math.ceil(A(0) / 1000)), k1 = Math.min(Math.floor(R / 1000), Math.floor(A(W) / 1000));
    for (let km = k0; km <= k1; km++) { const x = X(km * 1000), y = Y(km * 1000) + rw / 2 + 3; tk += `<rect x="${(x - 1.5).toFixed(1)}" y="${y.toFixed(1)}" width="3" height="${km % 5 ? 5 : 8}" rx="1"/>`; if (km % 5 === 0 && km) tk += `<text x="${x.toFixed(1)}" y="${(y + 19).toFixed(1)}">${km} km</text>`; }
    ticks.innerHTML = tk; ticks.setAttribute("fill", PHASES[phase].text);

    // carteles de parada
    let sg = "";
    const c = PHASES[phase];
    route.stops.forEach((s, i) => {
      const x = X(s.along); if (x < -140 || x > W + 140) return;
      const y = Y(s.along), passed = i <= view.passed, isNext = i === view.next && view.status === "en_curso" && !passed, isMine = mine && s.name === mine;
      const eta = view.etas.get(s.idx), label = s.short + (isNext && eta && Number.isFinite(eta.at) ? ` · ${fmtIn(eta.at, now)}` : "");
      const pole = Math.round(108 * Math.max(0.62, Math.min(1.15, H / 330))), w = Math.round(label.length * 7.4 + (isMine ? 34 : 22)), ph = 26, py = y - rw / 2 - pole;
      const fill = isNext ? "#e8261f" : passed ? "rgba(28,24,19,.55)" : "#ece8de", ink = isNext || passed ? "#fff" : "#1c1813";
      sg += `<g class="sign${passed ? " is-passed" : ""}${isNext ? " is-next" : ""}">`
        + `<rect x="${(x - 1.25).toFixed(1)}" y="${(py + ph).toFixed(1)}" width="2.5" height="${(pole - ph - 2).toFixed(1)}" fill="${c.text}" opacity=".7"/>`
        + `<rect x="${(x - w / 2).toFixed(1)}" y="${py.toFixed(1)}" width="${w}" height="${ph}" rx="5" fill="${fill}" stroke="rgba(28,24,19,.35)" stroke-width="1"/>`
        + (isMine ? `<path transform="translate(${(x - w / 2 + 9).toFixed(1)} ${(py + 6).toFixed(1)}) scale(.62)" d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="${ink}"/>` : "")
        + `<text x="${(x + (isMine ? 6 : 0)).toFixed(1)}" y="${(py + 17.5).toFixed(1)}" fill="${ink}" text-anchor="middle">${esc(label)}</text>`
        + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(rw * 0.55).toFixed(1)}" fill="${passed ? "#e8261f" : "#ece8de"}" stroke="#1c1813" stroke-width="1.5"/></g>`;
    });
    signs.innerHTML = sg;

    // la próxima parada fuera de vista: flecha en el borde
    const nx = view.route.stops[view.next];
    let ed = "";
    if (nx && view.status === "en_curso" && view.next > view.passed && X(nx.along) > W + 10) {
      const eta = view.etas.get(nx.idx), km = Math.max(0, (nx.along - disp) / 1000), txt = `${nx.short} · ${km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)} km${eta && Number.isFinite(eta.at) ? " · " + fmtIn(eta.at, now) : ""}`;
      const w = Math.round(txt.length * 7.2 + 40), x = W - w - 12, y = 14;
      ed = `<rect x="${x}" y="${y}" width="${w}" height="30" rx="15" fill="rgba(13,12,11,.78)"/><text x="${x + 14}" y="${y + 19.5}" fill="#fff">${esc(txt)}</text><path d="M${x + w - 20} ${y + 9}l7 6-7 6" fill="none" stroke="#e8261f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    edge.innerHTML = ed;

    // el coche: apoyado en el camino, inclinado con la pendiente
    const bxS = X(disp), by = Y(disp) - rw / 2 + 1, slope = Math.atan2(Y(disp + 60 / k) - Y(disp - 60 / k), 120) * 180 / Math.PI;
    const sc = Math.max(0.62, Math.min(W > 900 ? 1.75 : 1.15, (H / 330) * (W > 900 ? 1.35 : 1)));
    busG.setAttribute("transform", `translate(${bxS.toFixed(1)} ${by.toFixed(1)}) rotate(${slope.toFixed(2)}) scale(${sc.toFixed(3)})`);
    busG.classList.toggle("is-lost", view.freshness === "lost" || view.freshness === "none");
    const tagTxt = view.coach ? view.coach : "Colectivo";
    if (tag.textContent !== tagTxt) { tag.textContent = tagTxt; tagBox.setAttribute("width", tagTxt.length * 7.6 + 18); tagBox.setAttribute("x", -(tagTxt.length * 7.6 + 18) / 2); }
    if (!reduce()) { const rot = (disp / 2.9) * 57.3 % 360; wheels.forEach((w) => w.setAttribute("transform", `rotate(${rot.toFixed(1)})`)); }
  }

  // arrastrar para mirar el camino
  svg.addEventListener("pointerdown", (e) => { dragging = { x: e.clientX, look }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", (e) => {
    if (!dragging || !view) return;
    const k = W / span(); look = dragging.look - (e.clientX - dragging.x) / k;
    const R = view.route.length; look = Math.max(-disp - span() * 0.2, Math.min(R - disp + span() * 0.2, look));
    if (Math.abs(look) > 30) onLook?.(true);
  });
  const end = () => { if (!dragging) return; dragging = null; returnAt = performance.now() + 6000; };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);

  return {
    set(v, myStop = "") { if (!view || view.id !== v.id) disp = null; view = v; mine = myStop; },
    frame,
    back() { returnAt = 0; },
    destroy() { ro.disconnect(); svg.remove(); },
  };
}

// el coche Panamericano de costado (mira hacia la derecha: hacia donde avanza el recorrido)
function drawBus(g) {
  g.innerHTML = `
    <path class="bus__beam" d="M50 -16 L190 -40 L190 14 Z" fill="url(#evBeam)"/>
    <ellipse cx="0" cy="2" rx="52" ry="4" fill="rgba(0,0,0,.35)"/>
    <path d="M-50 -8 V-44 Q-50 -50 -44 -50 H40 Q50 -50 52 -40 L55 -16 Q56 -8 50 -8 Z" fill="#141210"/>
    <path d="M-50 -20 C-20 -22 10 -34 30 -50 H40 Q48 -50 50 -44 C30 -30 0 -16 -50 -12 Z" fill="#e8261f"/>
    <path d="M-50 -24 C-22 -26 6 -36 22 -50 H27 C10 -34 -18 -23 -50 -21 Z" fill="#d6a43a"/>
    <path d="M-46 -45 H34 V-33 H-46 Z" fill="#2b3640"/>
    <path d="M-46 -45 H34 V-33 H-46 Z" fill="none" stroke="rgba(255,255,255,.18)"/>
    <g stroke="#141210" stroke-width="2"><path d="M-33 -45 V-33"/><path d="M-19 -45 V-33"/><path d="M-5 -45 V-33"/><path d="M9 -45 V-33"/><path d="M23 -45 V-33"/></g>
    <path d="M38 -46 H43 Q48 -46 50 -40 L52 -30 H38 Z" fill="#2b3640"/>
    <rect x="50" y="-16" width="4" height="4" rx="1" fill="#fff3c8"/>
    <rect x="-50" y="-16" width="3" height="5" rx="1" fill="#e8261f"/>
    <g transform="translate(-30 -6)"><circle r="8" fill="#0b0a09"/><circle r="4.2" fill="#8b8579"/><g class="bus__spokes"><path d="M-4 0 H4 M0 -4 V4" stroke="#0b0a09" stroke-width="1.4"/></g></g>
    <g transform="translate(30 -6)"><circle r="8" fill="#0b0a09"/><circle r="4.2" fill="#8b8579"/><g class="bus__spokes"><path d="M-4 0 H4 M0 -4 V4" stroke="#0b0a09" stroke-width="1.4"/></g></g>
    <g class="bus__tag" transform="translate(0 -70)"><rect x="-30" y="-12" width="60" height="22" rx="11" fill="#0d0c0b"/><text x="0" y="3.5" text-anchor="middle" fill="#fff">INT</text></g>`;
}
