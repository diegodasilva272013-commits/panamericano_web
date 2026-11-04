// Panamericano en vivo: permite instalarla en el celular y abrirla aunque la señal sea mala.
// La pantalla y sus archivos se guardan al usarlos; los datos de los colectivos siempre se piden en el momento (nunca se guardan).
const CACHE = "envivo-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  const shell = (r.mode === "navigate" && u.pathname.startsWith("/envivo")) || /^\/(assets|fonts|img)\//.test(u.pathname) || /\.(png|webmanifest)$/.test(u.pathname);
  if (!shell) return;
  e.respondWith(fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((k) => k.put(r, c)); } return res; }).catch(() => caches.match(r).then((m) => m || caches.match("/envivo"))));
});
