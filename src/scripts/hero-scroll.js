import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Hero con scroll: una secuencia de cuadros dibujada en un <canvas> segun el progreso del scroll
// (misma tecnica y misma carga progresiva que el hero de /propuesta-payma).

const BG = "#050505";
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export async function initHeroScroll(cfg, { reduce }) {
  const root = document.querySelector("#hero");
  if (!root) return;
  const stage = root.querySelector(".hs__stage");
  const canvas = root.querySelector(".hs__canvas");
  const poster = root.querySelector(".hs__poster");
  const ctx = canvas.getContext("2d");
  const intro = root.querySelector(".hs__intro");
  const end = root.querySelector(".hs__end");
  const loadBar = root.querySelector(".hs__load i");
  const rail = root.querySelector(".hs__rail");
  const chaptersEl = [...root.querySelectorAll(".hs__chapter")];
  const mq = matchMedia("(max-width:700px)");

  let manifest;
  try { manifest = await (await fetch(`${cfg.base}/manifest.json`)).json(); }
  catch { return; } // sin manifest queda el poster
  const total = manifest.count;

  /* ---------- rangos de cada etapa (a partir de los cortes reales del video) ---------- */
  const b = [0, ...manifest.cortes, 1];
  const ranges = cfg.etapas.map((e, i) => ({
    from: i === 0 ? cfg.introHasta : b[e.clip],
    to: i === cfg.etapas.length - 1 ? cfg.cierreDesde - 0.01 : b[e.clip + 1],
  }));

  /* ---------- carga progresiva: 1.o, 1 de cada 8, 1 de cada 4, el resto ---------- */
  let images = [];
  let juego = "";
  let cancelLoad = () => {};
  let ready = false;
  let lastDrawn = -1;

  const frameUrl = (j, i) => `${cfg.base}/${j}/${manifest.patron.replace(/%0(\d)d/, (_, w) => String(i + 1).padStart(+w, "0"))}`;

  function load(j, staticOnly) {
    cancelLoad();
    juego = j; images = new Array(total).fill(null); ready = false; lastDrawn = -1;
    let cancelled = false; cancelLoad = () => { cancelled = true; };
    const order = [], seen = new Set();
    const push = (i) => { if (i >= 0 && i < total && !seen.has(i)) { seen.add(i); order.push(i); } };
    push(0);
    if (staticOnly) push(Math.round(cfg.cuadroEstatico * (total - 1)));
    else {
      for (let i = 0; i < total; i += 8) push(i);
      push(total - 1);
    }
    const firstPass = order.length;
    if (!staticOnly) { for (let i = 0; i < total; i += 4) push(i); for (let i = 0; i < total; i++) push(i); }
    let done = 0, cursor = 0;
    const next = () => {
      if (cancelled || cursor >= order.length) return;
      const idx = order[cursor], first = cursor < firstPass; cursor++;
      const img = new Image(); img.decoding = "async";
      img.onload = img.onerror = () => {
        if (cancelled) return;
        if (img.naturalWidth) images[idx] = img;
        if (first) {
          done++;
          if (loadBar) loadBar.style.transform = `scaleX(${done / firstPass})`;
          if (done === firstPass) { ready = true; stage.classList.add("is-ready"); }
        }
        next();
      };
      img.src = frameUrl(j, idx);
    };
    for (let k = 0; k < (staticOnly ? 2 : 6); k++) next();
  }

  const pick = () => (mq.matches ? "mobile" : "desktop");
  load(pick(), reduce);
  mq.addEventListener("change", () => load(pick(), reduce));

  /* ---------- dibujo ---------- */
  const nearest = (t) => {
    if (images[t]) return t;
    for (let d = 1; d < images.length; d++) { if (images[t - d]) return t - d; if (images[t + d]) return t + d; }
    return -1;
  };
  let lw = 0, lh = 0;
  function draw(p, force) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    const resized = w !== lw || h !== lh;
    if (resized) { canvas.width = w; canvas.height = h; lw = w; lh = h; }
    const idx = nearest(Math.round(clamp01(p) * (total - 1)));
    if (idx < 0 || (idx === lastDrawn && !resized && !force)) return;
    const img = images[idx];
    if (mq.matches) {
      // celular: el cuadro (1:1) va arriba y se funde con el fondo; el texto queda abajo
      const dw = w, dh = w * (img.naturalHeight / img.naturalWidth);
      const dy = Math.round((parseFloat(getComputedStyle(root).getPropertyValue("--nav-h")) + 8) * dpr);
      ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, dy, dw, dh);
      stage.style.setProperty("--img-b", `${(dy + dh) / dpr}px`);
    } else {
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    if (poster && !poster.classList.contains("is-off")) poster.classList.add("is-off");
    lastDrawn = idx;
  }

  /* ---------- textos por etapa ---------- */
  function overlays(p) {
    intro.style.opacity = String(1 - clamp01(p / cfg.introHasta));
    intro.style.pointerEvents = p < cfg.introHasta * 0.6 ? "auto" : "none";
    let active = -1;
    ranges.forEach((r, i) => {
      const el = chaptersEl[i]; if (!el) return;
      const span = r.to - r.from, fin = r.from + span * 0.18, fout = r.to - span * 0.22;
      let o = 0;
      if (p >= r.from && p <= r.to) o = p < fin ? (p - r.from) / (fin - r.from) : p > fout ? 1 - (p - fout) / (r.to - fout) : 1;
      o = clamp01(o);
      el.style.opacity = String(o);
      el.style.transform = `translateY(${(1 - o) * 16}px)`;
      if (o > 0.5) active = i;
    });
    const e = clamp01((p - cfg.cierreDesde) / (1 - cfg.cierreDesde) * 2.2);
    end.style.opacity = String(e);
    end.style.pointerEvents = e > 0.5 ? "auto" : "none";
    end.style.transform = `translateY(${(1 - e) * 24}px)`;
    stage.style.setProperty("--dim", String(0.55 * clamp01((p - 0.94) / 0.06)));
    if (rail) {
      rail.style.opacity = String(clamp01((p - cfg.introHasta) / 0.04) * (1 - e));
      [...rail.children].forEach((li, i) => li.classList.toggle("is-on", i === active || (active === -1 && i === 0 && p > cfg.introHasta)));
      rail.style.setProperty("--p", String(clamp01((p - cfg.introHasta) / (cfg.cierreDesde - cfg.introHasta))));
    }
  }

  /* ---------- modo sin movimiento: un cuadro fijo, sin pin ---------- */
  if (reduce) {
    root.classList.add("is-static");
    const t = setInterval(() => { if (ready || images.some(Boolean)) { draw(cfg.cuadroEstatico, true); clearInterval(t); } }, 120);
    intro.style.opacity = "1"; end.style.opacity = "1"; end.style.pointerEvents = "auto";
    chaptersEl.forEach((el) => (el.style.opacity = "0"));
    return;
  }

  /* ---------- progreso del scroll (suavizado propio, como el scrub de Payma) ---------- */
  const run = () => (mq.matches ? cfg.recorridoVh.mobile : cfg.recorridoVh.desktop);
  const setRun = () => root.style.setProperty("--run", `${run()}vh`);
  setRun(); ScrollTrigger.refresh(); mq.addEventListener("change", () => { setRun(); ScrollTrigger.refresh(); });

  let target = 0, cur = 0, visible = true;
  ScrollTrigger.create({
    trigger: root, start: "top top", end: "bottom bottom",
    onUpdate: (s) => { target = s.progress; },
    onToggle: (s) => { visible = s.isActive || s.progress === 1 || s.progress === 0; },
  });
  const tick = () => {
    if (!visible && Math.abs(target - cur) < 0.0005) return;
    cur += (target - cur) * 0.16;
    if (Math.abs(target - cur) < 0.0003) cur = target;
    draw(cur); overlays(cur);
  };
  gsap.ticker.add(tick);
  draw(0, true); overlays(0);
}
