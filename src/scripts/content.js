import { SUPABASE } from "./config.js";
import { setContent, TEXTS, SITE, HERO } from "./data.js";

const KEY = "pm-content-v1";

// Carga el contenido editable: primero lo último conocido (para arrancar ya), después lo trae de la base.
// Espera como máximo `maxWait` ms; si la base tarda más, la página sigue con lo que tiene y deja guardado lo nuevo para la próxima visita.
export function loadContent(maxWait = 1500) {
  try { const cached = JSON.parse(localStorage.getItem(KEY) || "null"); if (cached) setContent(cached); } catch { /* sin caché */ }
  if (!SUPABASE.url || !SUPABASE.anonKey) return Promise.resolve();
  const fresh = fetch(`${SUPABASE.url}/rest/v1/site_content?id=eq.main&select=data`, {
    headers: { apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}` },
  })
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => {
      const data = rows?.[0]?.data;
      if (data) { setContent(data); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* sin espacio */ } }
    })
    .catch(() => {});
  return Promise.race([fresh, new Promise((r) => setTimeout(r, maxWait))]);
}

const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

// Vuelca los textos editables sobre el HTML. Siempre con textContent: nada de lo que se escriba en el panel se interpreta como código.
export function applyTexts() {
  document.querySelectorAll("[data-t]").forEach((el) => {
    const v = get(TEXTS, el.dataset.t);
    if (typeof v === "string") el.textContent = v;
  });
  const facts = document.querySelector(".facts");
  if (facts && Array.isArray(TEXTS.facts) && TEXTS.facts.length) {
    facts.replaceChildren(...TEXTS.facts.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  }
  document.querySelectorAll("[data-site]").forEach((el) => {
    const v = SITE[el.dataset.site];
    if (typeof v === "string") el.textContent = v;
  });
  document.querySelectorAll("a[data-site-tel]").forEach((a) => { if (SITE.phoneTel) a.href = `tel:${SITE.phoneTel}`; });
  if (SITE.title) document.title = SITE.title;
}

// Si el hero tiene otra imagen de portada (video nuevo), la reemplaza antes de mostrar la web.
export function applyPoster() {
  const img = document.querySelector(".hs__poster");
  const src = document.querySelector(".hs__poster")?.previousElementSibling;
  const changed = [];
  if (HERO.posterMobile && src && src.getAttribute("srcset") !== HERO.posterMobile) { src.setAttribute("srcset", HERO.posterMobile); changed.push(1); }
  if (HERO.poster && img && img.getAttribute("src") !== HERO.poster) {
    changed.push(1);
    return new Promise((res) => {
      img.addEventListener("load", res, { once: true }); img.addEventListener("error", res, { once: true });
      img.src = HERO.poster;
      setTimeout(res, 3000);
    });
  }
  return Promise.resolve();
}
