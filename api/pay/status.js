import { respond } from "../_lib/runtime.js";

// Estado de una reserva para la pantalla de pago (confirmada, pendiente, vencida). No devuelve datos personales.
export default (req, res) => respond(req, res, ["GET"], (core, { query }) => core.status(query.code));
