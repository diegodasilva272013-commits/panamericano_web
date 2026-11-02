import { resolve } from "node:path";

// WhatsApp/Facebook exigen URLs ABSOLUTAS en las etiquetas og:*.
// %SITE_URL% se reemplaza al compilar: usa SITE_URL si existe; si no, el dominio que Vercel expone en el build.
// Si tenés dominio propio, definí SITE_URL=https://tudominio.com en Vercel (Settings > Environment Variables).
const site = () => {
  const e = process.env;
  const raw = e.SITE_URL || e.VERCEL_PROJECT_PRODUCTION_URL || e.VERCEL_URL || "http://localhost:5173";
  return (raw.startsWith("http") ? raw : `https://${raw}`).replace(/\/$/, "");
};

// /admin -> admin.html y /erp -> erp.html (en desarrollo y en vite preview; en Vercel lo resuelve cleanUrls de vercel.json)
const adminRoute = () => {
  const mw = (req, _res, next) => { for (const p of ["admin", "erp"]) if (req.url === "/" + p || req.url.startsWith("/" + p + "?")) req.url = "/" + p + ".html"; next(); };
  return { name: "admin-route", configureServer(s) { s.middlewares.use(mw); }, configurePreviewServer(s) { s.middlewares.use(mw); } };
};

export default {
  plugins: [
    { name: "site-url", transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", site()) },
    adminRoute(),
  ],
  build: {
    rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), admin: resolve(import.meta.dirname, "admin.html"), erp: resolve(import.meta.dirname, "erp.html") } },
  },
};
