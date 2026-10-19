// Datos relevados el 18/10/2026 (Ventanita, ficha jul-2026). Validar con boletería antes de publicar.
export const WA_NUMBER = "5493884640178";
export const AGENT_ID = "agent_0401m4gr7f3mf6kbawg54f6rwyv9";
export const TZ = "America/Argentina/Jujuy";

export const TRUNK = [
  "San Salvador de Jujuy", "Volcán", "Tumbaya", "Purmamarca", "Maimará", "Tilcara",
  "Huacalera", "Humahuaca", "Tres Cruces", "Abra Pampa", "La Quiaca",
];

const T = (s) => s.split(" ");

// from: origen con horario conocido · stops: localidades que sirve ese servicio, en orden de viaje
export const ROUTES = [
  {
    id: "jj-lq", to: "La Quiaca*", via: "Tilcara · Humahuaca · Abra Pampa", from: "San Salvador de Jujuy", service: "Ruta 9",
    stops: ["Purmamarca", "Maimará", "Tilcara", "Humahuaca", "Abra Pampa", "La Quiaca"],
    times: T("00:15 02:15 04:45 06:15 07:45 08:30 09:00 09:30 10:45 11:00 13:15 14:15 15:00 17:00 18:00 19:00 20:10 23:00"),
    note: "Servicio por Ruta 9 hacia Tilcara y Humahuaca. Algunas salidas continúan hasta La Quiaca: confirmalo en boletería.",
  },
  { id: "jj-iru", to: "Iruya", via: "vía Humahuaca", from: "San Salvador de Jujuy", service: "Iruya", stops: ["Humahuaca", "Iruya"], times: T("06:15 09:00"), note: "Servicio a Iruya vía Humahuaca." },
  { id: "jj-hy", to: "Hipólito Yrigoyen", via: "vía Purmamarca", from: "San Salvador de Jujuy", service: "Purmamarca", stops: ["Purmamarca", "Hipólito Yrigoyen"], times: T("06:15 09:00 10:45 17:00"), note: "Vía Purmamarca hasta Hipólito Yrigoyen (Iturbe)." },
  { id: "jj-ag", to: "Mina El Aguilar", via: "", from: "San Salvador de Jujuy", service: "Mina El Aguilar", stops: ["Mina El Aguilar"], times: ["14:15", "18:00"], days: { "14:15": "mar · jue · vie", "18:00": "domingos" }, note: "Salidas limitadas a ciertos días." },

  { id: "lq-jj", to: "Jujuy", via: "Abra Pampa · Humahuaca · Tilcara", from: "La Quiaca", service: "Ruta 9", stops: ["Abra Pampa", "Humahuaca", "Tilcara", "Maimará", "Purmamarca", "San Salvador de Jujuy"], times: T("03:00 07:15 09:20 10:40 13:15 14:15 16:00 18:00 19:30 21:00 23:00"), note: "Hacia Jujuy por Ruta 9." },

  { id: "ti-jj", to: "Jujuy", via: "Maimará · Purmamarca", from: "Tilcara", service: "Ruta 9", stops: ["Maimará", "Purmamarca", "San Salvador de Jujuy"], times: T("07:40 07:45 08:30 10:40 11:45 12:30 13:50 16:15 17:00 18:00 19:00 21:10 22:30 23:50"), note: "Hacia Jujuy por Ruta 9." },
  { id: "ti-lq", to: "La Quiaca", via: "Humahuaca · Abra Pampa", from: "Tilcara", service: "Ruta 9", stops: ["Humahuaca", "Abra Pampa", "La Quiaca"], times: T("00:50 01:50 03:30 06:15 07:40 09:20 10:20 10:55 12:35 12:50 14:35 16:30 19:00 19:40 20:50 21:30"), note: "Hacia la Puna por Ruta 9." },
  { id: "ti-pe", to: "Perico", via: "vía Palpalá", from: "Tilcara", service: "Perico", stops: ["Palpalá", "Perico"], times: T("16:15 19:00 23:50"), note: "Hacia Palpalá y Perico." },
  { id: "ti-iru", to: "Iruya", via: "vía Humahuaca", from: "Tilcara", service: "Iruya", stops: ["Iruya"], times: T("08:00 10:30"), note: "Servicio a Iruya." },
  { id: "ti-hy", to: "Hipólito Yrigoyen", via: "", from: "Tilcara", service: "Iturbe", stops: ["Hipólito Yrigoyen"], times: T("08:00 10:30 12:30 19:00"), note: "Hacia Hipólito Yrigoyen (Iturbe)." },
  { id: "ti-ag", to: "Mina El Aguilar", via: "", from: "Tilcara", service: "Mina El Aguilar", stops: ["Mina El Aguilar"], times: ["15:45", "19:40"], days: { "15:45": "mar · jue", "19:40": "domingos" }, note: "Salidas limitadas a ciertos días." },
];

// Perfil de la Ruta 9: altura aproximada (m s. n. m.) y kilometraje aproximado desde Jujuy. Validar antes de publicar.
export const JOURNEY = [
  { name: "San Salvador de Jujuy", short: "Jujuy", alt: 1260, km: 0, note: "Terminal Gral. Belgrano · donde empieza todo" },
  { name: "Volcán", short: "Volcán", alt: 1700, km: 28, note: "La puerta de entrada a la Quebrada" },
  { name: "Tumbaya", short: "Tumbaya", alt: 2050, km: 52, note: "Pueblo de paso, ya camino al cerro" },
  { name: "Purmamarca", short: "Purmamarca", alt: 2324, km: 65, note: "Frente al Cerro de los Siete Colores" },
  { name: "Maimará", short: "Maimará", alt: 2383, km: 79, note: "Bajo la Paleta del Pintor" },
  { name: "Tilcara", short: "Tilcara", alt: 2461, km: 86, note: "Pucará, peñas y música" },
  { name: "Huacalera", short: "Huacalera", alt: 2640, km: 107, note: "Sobre el Trópico de Capricornio" },
  { name: "Humahuaca", short: "Humahuaca", alt: 2939, km: 130, note: "Patrimonio de la Humanidad · UNESCO" },
  { name: "Tres Cruces", short: "Tres Cruces", alt: 3700, km: 172, note: "El punto más alto del recorrido" },
  { name: "Abra Pampa", short: "Abra Pampa", alt: 3484, km: 212, note: "En plena Puna jujeña" },
  { name: "La Quiaca", short: "La Quiaca", alt: 3442, km: 290, note: "Fin de la Ruta 9 · frontera con Bolivia" },
];

export const ORIGINS = [...new Set(ROUTES.map((r) => r.from))];
export const destinationsFor = (origin) => [...new Set(ROUTES.filter((r) => r.from === origin).flatMap((r) => r.stops))];

export function search(origin, dest) {
  const out = [];
  ROUTES.filter((r) => r.from === origin && r.stops.includes(dest)).forEach((r) =>
    r.times.forEach((t) => out.push({ time: t, service: r.service, days: r.days?.[t], note: r.note, route: r.id }))
  );
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export const short = (n) => ({ "San Salvador de Jujuy": "Jujuy" }[n] || n);

export const DESTINATIONS = [
  { name: "San Salvador de Jujuy", tag: "Cabecera", img: "terminal-jujuy", text: "Nueva Terminal Gral. Belgrano. Desde acá sale todo el corredor." },
  { name: "Tilcara", tag: "Quebrada", img: "tilcara", text: "Pucará, peñas y fiestas. A mitad de camino de la Quebrada." },
  { name: "Humahuaca", tag: "Patrimonio UNESCO", img: "humahuaca", text: "Corazón de la Quebrada y puerta de entrada a Iruya." },
  { name: "Abra Pampa", tag: "Puna", img: "abrapampa", text: "Altiplano a más de 3.400 metros, camino a la frontera." },
  { name: "La Quiaca", tag: "Frontera", img: "laquiaca", text: "El final de la Ruta 9, cruzando el puente hacia Bolivia." },
  { name: "Perico", tag: "Valles", img: "perico", text: "Servicios que nacen en Perico y pasan por Jujuy." },
];

export const BOLETERIAS = [
  { name: "San Salvador de Jujuy", tel: "388 464-0178", sub: "Terminal · Puesto del Marqués 605" },
  { name: "Tilcara", tel: "388 464-0179" },
  { name: "Humahuaca", tel: "388 464-0180" },
  { name: "Abra Pampa", tel: "388 464-0181" },
  { name: "La Quiaca", tel: "388 508-7661" },
  { name: "Iruya", tel: "387 571-8801" },
];

export const FAQ = [
  ["¿Salen todos los días?", "Sí. Operamos de lunes a domingo, incluidos feriados. En feriados y Carnaval las frecuencias pueden variar: consultalo antes de viajar."],
  ["¿Cuánto equipaje puedo llevar?", "Un bolso de mano de hasta 5 kg en la butaca y, en bodega, un bulto de hasta 75 × 50 cm y 30 kg. El exceso se cobra según tarifa de encomiendas."],
  ["¿Puedo viajar con mi mascota?", "No. Por norma del servicio no se permite viajar con animales."],
  ["¿Qué necesita un menor para viajar?", "De 0 a 4 años viajan sin butaca, solo con seguro. Desde los 5 pagan pasaje completo. Hasta 12 años siempre con madre, padre, representante legal o persona autorizada. De 13 a 17, acompañados o con autorización de un representante legal."],
  ["¿Qué documento me piden?", "DNI tarjeta, libreta celeste (también en versión digital) o pasaporte. No se aceptan DNI escritos a mano, constancias en trámite ni documentos deteriorados."],
  ["¿Cuánto me devuelven si cancelo?", "Se retiene el 30 % si cancelás con menos de 24 h, 20 % con menos de 48 h y 10 % con más de 48 h. Los pasajes vencidos no se reintegran."],
  ["¿Con cuánta anticipación llego?", "Te recomendamos presentarte entre 30 y 45 minutos antes de la salida."],
  ["¿Tienen WiFi?", "Sí, a bordo hay WiFi Starlink, aire acondicionado y calefacción, pantallas rebatibles, luz de lectura y puerto USB."],
];

export const SERVICES = [
  ["WiFi", "Starlink a bordo"],
  ["Clima", "Aire acondicionado y calefacción"],
  ["Pantallas", "Rebatibles, con audio y video"],
  ["Energía", "Puerto USB en la butaca"],
  ["Luz", "De lectura individual"],
  ["Horarios", "Todos los días, feriados incluidos"],
];
