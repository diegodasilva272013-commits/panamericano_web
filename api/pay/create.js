import { respond } from "../_lib/runtime.js";

// Crea el pago de una reserva: link de Mercado Pago o CVU/alias de transferencia. El monto sale de la base.
export default (req, res) => respond(req, res, ["POST"], (core, { body }) => core.createPayment({ code: body?.code, method: body?.method }));
