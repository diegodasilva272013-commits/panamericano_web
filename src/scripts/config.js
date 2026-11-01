// Conexión con Supabase (el servicio donde se guarda el contenido que se edita desde /admin).
// Estos dos valores son PÚBLICOS por diseño (la seguridad la dan las reglas de la base): se pueden subir al repositorio.
// Dos formas de completarlos (una sola vez, después de crear el proyecto en Supabase; ver README > "Panel de administración"):
//   1) escribirlos acá abajo, o
//   2) definir VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY como variables de entorno (en Vercel: Settings > Environment Variables).
// Si están vacíos, la web usa el contenido por defecto y el panel muestra las instrucciones de instalación.
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
// Opcional: ruta del propio sitio desde la que se sirven los cuadros del hero nuevo (ver README, "Tráfico de los cuadros del hero").
export const FRAMES_PROXY = env.VITE_FRAMES_PROXY || "";
export const SUPABASE = {
  url: env.VITE_SUPABASE_URL || "",
  anonKey: env.VITE_SUPABASE_ANON_KEY || "",
};
