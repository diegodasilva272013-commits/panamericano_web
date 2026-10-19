import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { preloadImages } from "./utils.js";
import { ORIGINS, destinationsFor, short, DESTINATIONS, BOLETERIAS, FAQ, SERVICES } from "./data.js";
import { initSchedule, setRoute, fillSelect } from "./schedule.js";
import { initBooking, prefill } from "./booking.js";
import { initVoice } from "./voice.js";
import { initWhatsapp } from "./whatsapp.js";
import { initJourney } from "./journey.js";
import { initHeroScroll } from "./hero-scroll.js";
import { HERO } from "./hero.config.js";

gsap.registerPlugin(ScrollTrigger);
const $ = (s) => document.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let lenis;

/* ---------- Efecto sticky grid (hero) ---------- */
class StickyGridScroll {
  constructor() {
    this.getElements();
    this.initContent();
    this.groupItemsByColumn();
    this.addParallaxOnScroll();
    this.animateTitleOnScroll();
    this.animateGridOnScroll();
  }
  getElements() {
    this.block = document.querySelector(".block--main");
    if (!this.block) return;
    this.wrapper = this.block.querySelector(".block__wrapper");
    this.content = this.block.querySelector(".content");
    this.title = this.block.querySelector(".content__title");
    this.description = this.block.querySelector(".content__description");
    this.button = this.block.querySelector(".content__button");
    this.grid = this.block.querySelector(".gallery__grid");
    this.items = this.block.querySelectorAll(".gallery__item");
  }
  initContent() {
    if (this.description && this.button) gsap.set([this.description, this.button], { opacity: 0, pointerEvents: "none" });
    if (this.content && this.title) {
      const dy = (this.content.offsetHeight - this.title.offsetHeight) / 2;
      this.titleOffsetY = (dy / this.content.offsetHeight) * 100;
      gsap.set(this.title, { yPercent: this.titleOffsetY });
    }
  }
  groupItemsByColumn() {
    this.numColumns = 3;
    this.columns = Array.from({ length: this.numColumns }, () => []);
    this.items.forEach((item, i) => this.columns[i % this.numColumns].push(item));
  }
  addParallaxOnScroll() {
    if (!this.block || !this.wrapper) return;
    gsap.from(this.wrapper, { yPercent: -100, ease: "none", scrollTrigger: { trigger: this.block, start: "top bottom", end: "top top", scrub: true } });
  }
  animateTitleOnScroll() {
    if (!this.block || !this.title) return;
    gsap.from(this.title, { opacity: 0, duration: 0.7, ease: "power1.out", scrollTrigger: { trigger: this.block, start: "top 57%", toggleActions: "play none none reset", onRefresh: (self) => { if (self.scroll() > self.start) gsap.set(this.title, { opacity: 1 }); } } });
  }
  gridRevealTimeline(columns = this.columns) {
    const tl = gsap.timeline();
    const wh = window.innerHeight;
    const dy = wh - (wh - this.grid.offsetHeight) / 2;
    columns.forEach((col, i) => {
      const fromTop = i % 2 === 0;
      tl.from(col, { y: dy * (fromTop ? -1 : 1), stagger: { each: 0.06, from: fromTop ? "end" : "start" }, ease: "power1.inOut" }, "grid-reveal");
    });
    return tl;
  }
  gridZoomTimeline(columns = this.columns) {
    const tl = gsap.timeline({ defaults: { duration: 1, ease: "power3.inOut" } });
    tl.to(this.grid, { scale: 2.05 });
    tl.to(columns[0], { xPercent: -40 }, "<");
    tl.to(columns[2], { xPercent: 40 }, "<");
    tl.to(columns[1], { yPercent: (i) => (i < Math.floor(columns[1].length / 2) ? -1 : 1) * 40, duration: 0.5, ease: "power1.inOut" }, "-=.5");
    return tl;
  }
  toggleContent(isVisible = true) {
    if (!this.title || !this.description || !this.button) return;
    gsap.timeline({ defaults: { overwrite: true } })
      .to(this.title, { yPercent: isVisible ? 0 : this.titleOffsetY, duration: 0.7, ease: "power2.inOut" })
      .to([this.description, this.button], { opacity: isVisible ? 1 : 0, duration: 0.4, ease: `power1.${isVisible ? "inOut" : "out"}`, pointerEvents: isVisible ? "all" : "none" }, isVisible ? "-=90%" : "<");
  }
  destroy() {
    ScrollTrigger.getAll().forEach((st) => { if (st.trigger === this.block) { st.animation?.revert?.(); st.kill(); } });
    gsap.set([this.wrapper, this.title, this.description, this.button, this.grid, ...this.items], { clearProps: "all" });
  }
  animateGridOnScroll() {
    const tl = gsap.timeline({ scrollTrigger: { trigger: this.block, start: "top 25%", end: "bottom bottom", scrub: true } });
    tl.add(this.gridRevealTimeline()).add(this.gridZoomTimeline(), "-=.6").add(() => this.toggleContent(tl.scrollTrigger.direction === 1), "-=.32");
  }
}

function initSmoothScrolling() {
  lenis = new Lenis({ lerp: 0.08, wheelMultiplier: 1.2 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute("href") === "#") return;
    const target = document.querySelector(a.getAttribute("href"));
    if (!target) return;
    e.preventDefault();
    lenis.scrollTo(target, { offset: -40, duration: 1.4 });
  });
}
const goTo = (sel) => lenis ? lenis.scrollTo(sel, { offset: -40, duration: 1.4 }) : document.querySelector(sel)?.scrollIntoView({ behavior: "smooth" });

/* ---------- Contenido dinámico ---------- */
const GALLERY = [
  ["tilcara", "Tilcara"], ["humahuaca", "Humahuaca"], ["laquiaca", "La Quiaca"],
  ["bus-negro", "Nuestra flota"], ["terminal-jujuy", "Jujuy"], ["abrapampa", "Abra Pampa"],
  ["perico", "Perico"], ["bus-ruta", "Ruta 9"], ["tilcara-b", "Quebrada"],
];

function renderStatic() {
  $("#gallery").innerHTML = GALLERY.map(([img, cap]) =>
    `<li class="gallery__item"><img class="gallery__image" src="/img/${img.replace(/-b$/, "")}.avif" alt="${cap}" style="${img.endsWith("-b") ? "object-position:100% 50%;transform:scale(1.5)" : ""}" /><span class="gallery__cap">${cap}</span></li>`).join("");

  $("#rail").innerHTML = DESTINATIONS.map((d) => `
    <article class="card">
      <img src="/img/${d.img}.avif" alt="${d.name}" draggable="false" />
      <div class="card__body">
        <span class="card__tag">${d.tag}</span>
        <h3>${short(d.name)}</h3>
        <p>${d.text}</p>
        <button type="button" data-goto="${d.name}">Ver horarios</button>
      </div>
    </article>`).join("");

  $("#specs").innerHTML = SERVICES.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  $("#faq").innerHTML = FAQ.map(([q, a]) => `<details><summary>${q}</summary><div class="ans"><p>${a}</p></div></details>`).join("");
  $("#boleterias").innerHTML = BOLETERIAS.map((b) =>
    `<li><div><b>${b.name}</b>${b.sub ? `<small>${b.sub}</small>` : ""}</div><a href="tel:+54${b.tel.replace(/\D/g, "")}">${b.tel}</a></li>`).join("");
}

/* ---------- Buscador de portada ---------- */
function initFinder() {
  const o = $("#f-origin"), d = $("#f-dest");
  fillSelect(o, ORIGINS, "San Salvador de Jujuy");
  fillSelect(d, destinationsFor(o.value), "La Quiaca");
  o.addEventListener("change", () => fillSelect(d, destinationsFor(o.value), d.value));
  $("#f-swap").addEventListener("click", () => {
    const no = d.value, nd = o.value;
    if (!ORIGINS.includes(no)) return gsap.fromTo("#f-swap", { x: -4 }, { x: 0, duration: 0.5, ease: "elastic.out(1,.3)" });
    o.value = no; fillSelect(d, destinationsFor(no), nd);
  });
  $("#finder").addEventListener("submit", (e) => { e.preventDefault(); setRoute(o.value, d.value); goTo("#horarios"); });
}

/* ---------- Animaciones ---------- */
function initMotion() {
  ScrollTrigger.create({ start: 40, end: "max", onUpdate: (s) => $("#nav").classList.toggle("is-solid", s.scroll() > 40) });

  if (!reduce) {

    document.querySelectorAll(".sec__head,.sched,.book,.faq,.specs div,.facts__item,.contact__lead,.boleterias li,.board__media,.board,.sched").forEach((el) => el.classList.add("rv"));
    ScrollTrigger.batch(".rv", { start: "top 88%", once: true, onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.08 }) });

    document.querySelectorAll("[data-count]").forEach((el) => {
      const end = +el.dataset.count, o = { v: 0 };
      ScrollTrigger.create({ trigger: el, start: "top 90%", once: true, onEnter: () => gsap.to(o, { v: end, duration: 1.6, ease: "power2.out", onUpdate: () => (el.textContent = Math.round(o.v)) }) });
    });

  } else {
    document.querySelectorAll("[data-count]").forEach((el) => (el.textContent = el.dataset.count));
  }
}

function initDock() {
  const dock = $("#dock");
  let inBook = false, idle = 0;
  const sync = () => dock.classList.toggle("is-away", inBook || dock.dataset.moving === "1");
  const zones = { "#reservar": false, "#viaje": false };
  Object.keys(zones).forEach((id) => ScrollTrigger.create({ trigger: id, start: "top 70%", end: "bottom 30%", onToggle: (s) => { zones[id] = s.isActive; inBook = Object.values(zones).some(Boolean); sync(); } }));
  // se aparta mientras bajás y vuelve cuando frenás o subís
  lenis?.on("scroll", ({ velocity, scroll }) => {
    if (scroll < 120) { dock.dataset.moving = "0"; return sync(); }
    dock.dataset.moving = velocity > 1.2 ? "1" : "0";
    sync(); clearTimeout(idle); idle = setTimeout(() => { dock.dataset.moving = "0"; sync(); }, 700);
  });
  // nav clara sobre las secciones crema
  ScrollTrigger.create({ trigger: ".swoosh", start: "top 64px", end: "max", onUpdate: (st) => $("#nav").classList.toggle("is-light", st.progress > 0) });
}

function initRail() {
  const rail = $("#rail");
  let down = false, sx = 0, sl = 0, moved = false;
  rail.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") return; down = true; moved = false; sx = e.clientX; sl = rail.scrollLeft; });
  window.addEventListener("pointermove", (e) => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 4) { moved = true; rail.classList.add("is-drag"); } rail.scrollLeft = sl - dx; });
  window.addEventListener("pointerup", () => { down = false; rail.classList.remove("is-drag"); });
  rail.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (!b || moved) return;
    const dest = b.dataset.goto;
    const J = "San Salvador de Jujuy";
    if (dest === J) setRoute("La Quiaca", J);
    else if (destinationsFor(J).includes(dest)) setRoute(J, dest);
    else setRoute("Tilcara", dest);
    goTo("#horarios");
  });
}

/* ---------- Hero: contenido desde hero.config.js ---------- */
function renderHero(c) {
  const btn = (x) => `<a class="btn ${x.primary ? "btn--accent" : "btn--ghost"}" href="${x.href}"${x.external ? ' target="_blank" rel="noopener"' : ""}>${x.label}</a>`;
  $("#hs-intro").innerHTML = `<h1>${c.headline}</h1><p class="hs__sub">${c.subheadline}</p><div class="hs__ctas">${c.ctas.map(btn).join("")}</div><p class="hs__hint">${c.hint}</p>`;
  $("#hs-chapters").innerHTML = c.etapas.map((e) => `<div class="hs__chapter"><h2>${e.title}</h2><p>${e.detail}</p></div>`).join("");
  $("#hs-rail").innerHTML = c.etapas.map((e) => `<li>${e.rail}</li>`).join("");
  $("#hs-end-title").textContent = c.cierre.title; $("#hs-end-text").textContent = c.cierre.text;
}

/* ---------- Arranque ---------- */
renderHero(HERO);
renderStatic();
initFinder();
initSchedule({ onBook: (p) => { prefill(p); goTo("#reservar"); } });
initBooking();
initVoice();
initWhatsapp();
initRail();

preloadImages().then(() => {
  document.body.classList.remove("loading");
  initSmoothScrolling();
  initHeroScroll(HERO, { reduce });
  let grid = new StickyGridScroll();
  let rz = 0, lastW = innerWidth, lastH = innerHeight;
  addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (Math.abs(innerWidth - lastW) < 2 && Math.abs(innerHeight - lastH) < 60) return; // la barra del navegador en celular no cuenta
      lastW = innerWidth; lastH = innerHeight;
      grid.destroy(); grid = new StickyGridScroll(); ScrollTrigger.refresh();
    }, 250);
  });
  initMotion();
  initDock();
  initJourney(reduce);
  ScrollTrigger.refresh();
});
