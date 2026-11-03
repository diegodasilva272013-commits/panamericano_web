// Acceso a la base de datos del receptor. Solo usa funciones de Supabase pensadas para el servidor (clave de servicio, solo en el VPS).
// El servidor recibe un "store" con estos cuatro métodos: en producción es éste y en las pruebas es uno conectado a un Postgres en memoria.
import { createClient } from "@supabase/supabase-js";

export function supabaseStore({ url, key }) {
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const call = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw Object.assign(new Error(`${fn}: ${error.message}`), { code: error.code });
    return data;
  };
  return {
    config: () => call("gps_config"),
    save: (p) => call("gps_save", { p }),
    unknown: (p) => call("gps_unknown", { p }),
    purge: () => call("gps_purge", {}),
    positionsSince: (vehicleId, fromIso, limit = 20000) => call("gps_positions_since", { p_vehicle: vehicleId, p_from: fromIso, p_limit: limit }),
  };
}
