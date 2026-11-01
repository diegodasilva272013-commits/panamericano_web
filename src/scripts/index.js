import { HERO, esc } from "./data.js";
import { loadContent, applyTexts, applyPoster } from "./content.js";
import { initHeroScroll } from "./hero-scroll.js";

// Entrada minima: muestra la portada lo antes posible. El resto de la pagina (reserva, tablero, efectos, voz...)
// vive en app.js y se descarga y arma despues de soltar la pantalla de carga.
// Todo el contenido editable (textos, horarios, imagenes, hero) llega desde la base y se edita en /admin.
const $ = (s) => document.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// solo enlaces seguros en los botones editables
const safeHref = (h) => (/^(https?:\/\/|tel:|mailto:|#|\/)/i.test(String(h || "")) ? h : "#");

/* ---------- Hero: contenido desde el panel / defaults ---------- */
function renderHero(c) {
  const btn = (x) => `<a class="btn ${x.primary ? "btn--accent" : "btn--ghost"}" href="${esc(safeHref(x.href))}"${x.external ? ' target="_blank" rel="noopener"' : ""}>${esc(x.label)}</a>`;
  $("#hs-intro").innerHTML = `<h1>${esc(c.headline)}</h1><p class="hs__sub">${esc(c.subheadline)}</p><div class="hs__ctas">${c.ctas.map(btn).join("")}</div><p class="hs__hint">${esc(c.hint)}</p>`;
  $("#hs-chapters").innerHTML = c.etapas.map((e) => `<div class="hs__chapter"><h2>${esc(e.title)}</h2><p>${esc(e.detail)}</p></div>`).join("");
  $("#hs-rail").innerHTML = c.etapas.map((e) => `<li>${esc(e.rail)}</li>`).join("");
  $("#hs-end-title").textContent = c.cierre.title; $("#hs-end-text").textContent = c.cierre.text;
}

// La pantalla de carga solo espera lo necesario para el primer vistazo: la imagen de portada, las tipografias y el contenido.
// El resto de las imagenes se sigue cargando en segundo plano (sus cajas ya tienen proporcion fija: no hay saltos de layout).
const contentReady = loadContent(1500);

function whenReady() {
  const poster = document.querySelector(".hs__poster");
  const posterReady = new Promise((res) => {
    if (!poster || poster.complete) return res();
    poster.addEventListener("load", res, { once: true });
    poster.addEventListener("error", res, { once: true });
  });
  const cap = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
  return Promise.all([cap(posterReady, 6000), cap(document.fonts ? document.fonts.ready : Promise.resolve(), 1500), contentReady]);
}

whenReady().then(async () => {
  applyTexts();
  await applyPoster(); // si el hero tiene otra portada, se cambia antes de mostrar nada
  renderHero(HERO);
  document.body.classList.remove("loading");
  initHeroScroll(HERO, { reduce });
  // el resto de la pagina: se descarga ahora, ya con la portada a la vista
  import("./app.js").then((m) => m.startApp());
});
