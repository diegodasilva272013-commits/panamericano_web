import { respond } from "../_lib/runtime.js";

// Aviso de Talo. Talo todavía no firma sus avisos: se exige la clave del enlace y se consulta el pago a Talo antes de registrar nada.
export default (req, res) => respond(req, res, ["POST"], (core, ctx) => core.taloWebhook(ctx));
