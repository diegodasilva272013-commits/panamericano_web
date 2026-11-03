import { respond } from "../_lib/runtime.js";

// Qué medios de pago están activados (la web muestra los botones solo si hay alguno).
export default (req, res) => respond(req, res, ["GET"], (core) => core.config());
