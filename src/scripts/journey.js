import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { JOURNEY } from "./data.js";

const $ = (s) => document.querySelector(s);
const ALT_MIN = 600, ALT_MAX = 3900, KM_MAX = 290;

// Paletas a lo largo del camino: valle → Quebrada → Puna
const SKY_TOP = ["#0e1b17", "#1c110c", "#0a1124"];
const SKY_BOT = ["#1e3527", "#5c2b15", "#324068"];
const GROUND = ["#2c4a35", "#9b4625", "#b98a4e"];

// spline monótona (sin rebotes entre paradas)
function monotonePath(pts) {
  const n = pts.length, dx = [], dy = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1].x - pts[i].x; dy[i] = pts[i + 1].y - pts[i].y; m[i] = dy[i] / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3, x2 = pts[i + 1].x - dx[i] / 3;
    d += ` C${x1},${pts[i].y + (dx[i] / 3) * t[i]} ${x2},${pts[i + 1].y - (dx[i] / 3) * t[i + 1]} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

export function initJourney(reduce) {
  const sec = $("#viaje"); if (!sec) return;
  const chart = $("#v-chart"), svg = $("#v-svg"), bus = $("#v-bus");
  const ground = $("#v-ground"), line = $("#v-line"), prog = $("#v-prog"), grid = $("#v-grid");
  const labels = $("#v-labels"), altEl = $("#v-alt"), stopEl = $("#v-stop"), noteEl = $("#v-note");
  const fmt = new Intl.NumberFormat("es-AR");

  let spanNow = 1, W = 0, H = 0, L = 0, startLen = 0, pts = [], dots = [], active = -1, topPad = 0;
  const st = { p: 0 };

  function build() {
    W = chart.clientWidth; H = chart.clientHeight;
    const mobile = W < 700;
    const padX = Math.max(mobile ? 46 : 70, bus.offsetWidth / 2 + 10); topPad = H * (mobile ? 0.1 : 0.09);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const span = (H - topPad - 4) * (mobile ? 0.78 : 1);
    spanNow = span;
    const yOf = (alt) => H - 4 - ((alt - ALT_MIN) / (ALT_MAX - ALT_MIN)) * span;
    pts = JOURNEY.map((s) => ({ x: padX + (s.km / KM_MAX) * (W - padX * 2), y: yOf(s.alt) }));
    const d = monotonePath(pts);
    line.setAttribute("d", d); prog.setAttribute("d", d);
    const first = pts[0], last = pts[pts.length - 1];
    ground.setAttribute("d", `M0,${first.y} L${first.x},${first.y} ${d.replace(/^M[^C]+/, "")} L${W},${last.y} L${W},${H} L0,${H} Z`);
    line.setAttribute("d", `M0,${first.y} L${first.x},${first.y} ${d.replace(/^M[^C]+/, "")} L${W},${last.y}`);
    prog.setAttribute("d", line.getAttribute("d"));
    L = line.getTotalLength();
    startLen = (first.x);
    prog.style.strokeDasharray = L;

    // referencias de altura
    grid.innerHTML = [1500, 2500, 3500].map((a) => `<g><line x1="0" x2="${W}" y1="${yOf(a)}" y2="${yOf(a)}"/><text x="${mobile ? W - 8 : padX - 10}" ${mobile ? 'text-anchor="end"' : ""} y="${yOf(a) - 6}">${fmt.format(a)} m</text></g>`).join("");

    // paradas
    const baseY = H - 66;
    labels.innerHTML = JOURNEY.map((s, i) => { const ty = baseY + (i % 3) * 19 - pts[i].y; return `<li style="left:${pts[i].x}px;top:${pts[i].y}px" data-i="${i}"><i></i><u style="height:${Math.max(0, ty)}px"></u><span style="top:${ty}px">${s.short}</span></li>`; }).join("");
    dots = [...labels.children];
    active = -1;
    render();
  }

  function render() {
    const s = startLen + Math.max(0, Math.min(1, st.p)) * (L - startLen - (W - pts[pts.length - 1].x));
    const a = line.getPointAtLength(s), b = line.getPointAtLength(Math.min(L, s + 14)), c = line.getPointAtLength(Math.max(0, s - 14));
    const ang = Math.max(-30, Math.min(30, (Math.atan2(b.y - c.y, b.x - c.x) * 180) / Math.PI));
    bus.style.transform = `translate(${a.x - bus.offsetWidth / 2}px,${a.y - bus.offsetHeight + 7}px) rotate(${ang}deg)`;
    prog.style.strokeDashoffset = L - s;

    const alt = ALT_MIN + ((H - 4 - a.y) / spanNow) * (ALT_MAX - ALT_MIN);
    altEl.textContent = fmt.format(Math.round(alt / 5) * 5);

    let idx = 0;
    pts.forEach((p, i) => { if (p.x <= a.x + 14) idx = i; });
    dots.forEach((el, i) => { el.classList.toggle("is-passed", pts[i].x <= a.x + 1); el.classList.toggle("is-on", i === idx); });
    if (idx !== active) {
      active = idx;
      stopEl.textContent = JOURNEY[idx].name; noteEl.textContent = JOURNEY[idx].note;
      if (!reduce) gsap.fromTo([stopEl, noteEl], { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out", stagger: 0.06, overwrite: true });
    }
    const p = st.p;
    sec.classList.toggle("is-moving", p > 0.015);
    sec.classList.toggle("is-end", p > 0.955);
    sec.style.setProperty("--sky-top", gsap.utils.interpolate(SKY_TOP, p));
    sec.style.setProperty("--sky-bot", gsap.utils.interpolate(SKY_BOT, p));
    sec.style.setProperty("--ground", gsap.utils.interpolate(GROUND, p));
  }

  build();
  new ResizeObserver(() => { build(); ScrollTrigger.refresh(); }).observe(chart);

  if (reduce) { sec.classList.add("is-static"); st.p = 1; render(); return; }
  ScrollTrigger.create({
    trigger: sec, start: "top top", end: "bottom bottom",
    onUpdate: (self) => gsap.to(st, { p: self.progress, duration: 0.6, ease: "power3.out", overwrite: true, onUpdate: render }),
  });
}
