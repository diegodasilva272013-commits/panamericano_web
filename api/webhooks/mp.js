import { respond } from "../_lib/runtime.js";

// Aviso de Mercado Pago. Se valida la firma y se consulta el pago a Mercado Pago antes de registrar nada.
export default (req, res) => respond(req, res, ["POST"], (core, ctx) => core.mpWebhook(ctx));
