// CONTENIDO POR DEFECTO de la web. Es lo que se ve si el panel de administración todavía no guardó nada
// (y el respaldo si el servicio de datos no responde). El panel /admin parte de acá y guarda sus cambios en la base.
// Datos relevados el 18/10/2026 (Ventanita, ficha jul-2026). Validar con boletería antes de publicar.

const T = (s) => s.split(" ");

export const DEFAULT_CONTENT = {
  version: 1,

  site: {
    whatsapp: "5493884640178",
    agentId: "agent_0401m4gr7f3mf6kbawg54f6rwyv9",
    phoneLabel: "0388 425-4331",
    phoneTel: "+543884254331",
    address: "Terminal de Ómnibus Gral. Manuel Belgrano · Puesto del Marqués 605 · San Salvador de Jujuy (4600)",
    footerNote: "Transporte de pasajeros en Jujuy. Operamos todos los días, incluidos feriados. Sitio de demostración.",
    title: "Panamericano Bus | Jujuy, Quebrada y Puna",
  },

  texts: {
    nav: { horarios: "Horarios", destinos: "Destinos", reservar: "Reservar", antes: "Antes de viajar", contacto: "Contacto" },
    grid: { a: "Conectamos", b: "caminos.", text: "Trabajadores, vecinos y viajeros entre los cerros de colores y el altiplano.", button: "Ver horarios ↓" },
    facts: ["Todos los días", "Feriados incluidos", "11 localidades", "6 boleterías"],
    horarios: { a: "Próximas salidas.", b: "En vivo, desde tu origen.", all: "Todas las salidas del día", clock: "hora de Jujuy" },
    destinos: { a: "Del valle", b: "al altiplano." },
    viaje: { hint: "Seguí el camino", cta: "Reservar Jujuy → La Quiaca" },
    reservar: { a: "Reservá tu lugar", b: "en cuatro pasos.", legal: "Demo de reserva: la solicitud se confirma con la boletería por WhatsApp. No se realiza ningún cobro y la tarifa se informa al confirmar." },
    abordo: { a: "Viajá", b: "conectado." },
    antes: { a: "Lo que", b: "conviene saber." },
    contacto: { a: "Hablemos.", b: "Estamos en el camino.", call: "Llamar ahora", wa: "Escribir por WhatsApp", central: "Central" },
  },

  hero: {
    // rutas técnicas (no se editan desde el panel salvo al subir un video nuevo)
    base: "/panamericano/frames",
    poster: "/panamericano/hero-poster.webp",
    posterMobile: "/panamericano/hero-poster-mobile.webp",
    frames: null, // null = secuencia original incluida en el sitio; el panel la reemplaza al subir un video nuevo
    recorridoVh: { desktop: 760, mobile: 560 },
    introHasta: 0.06,
    cierreDesde: 0.93,
    cuadroEstatico: 0.5,
    // textos
    headline: "El norte te espera",
    subheadline: "Viajes diarios a los principales destinos del norte jujeño",
    hint: "Deslizá para viajar",
    ctas: [
      { label: "Ver horarios", href: "#horarios", primary: true },
      { label: "WhatsApp", href: "https://wa.me/5493884640178", external: true },
    ],
    etapas: [
      { clip: 0, rail: "Purmamarca", title: "Purmamarca", detail: "Cerro de los Siete Colores" },
      { clip: 1, rail: "Maimará", title: "Maimará", detail: "La Paleta del Pintor" },
      { clip: 2, rail: "Humahuaca", title: "Quebrada de Humahuaca", detail: "Patrimonio de la Humanidad" },
      { clip: 3, rail: "Abra Pampa", title: "Abra Pampa", detail: "La Puna, a 3.500 m" },
      { clip: 4, rail: "La Quiaca", title: "La Quiaca", detail: "El norte del país" },
    ],
    cierre: {
      title: "Llegá al norte.",
      text: "Todos los días, feriados incluidos. Desde la Terminal de San Salvador hasta La Quiaca.",
    },
  },

  // from: origen con horario conocido · stops: localidades que sirve ese servicio, en orden de viaje
  routes: [
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
  ],

  destinations: [
    { name: "San Salvador de Jujuy", tag: "Cabecera", image: "/img/terminal-jujuy.avif", text: "Nueva Terminal Gral. Belgrano. Desde acá sale todo el corredor." },
    { name: "Tilcara", tag: "Quebrada", image: "/img/tilcara.avif", text: "Pucará, peñas y fiestas. A mitad de camino de la Quebrada." },
    { name: "Humahuaca", tag: "Patrimonio UNESCO", image: "/img/humahuaca.avif", text: "Corazón de la Quebrada y puerta de entrada a Iruya." },
    { name: "Abra Pampa", tag: "Puna", image: "/img/abrapampa.avif", text: "Altiplano a más de 3.400 metros, camino a la frontera." },
    { name: "La Quiaca", tag: "Frontera", image: "/img/laquiaca.avif", text: "El final de la Ruta 9, cruzando el puente hacia Bolivia." },
    { name: "Perico", tag: "Valles", image: "/img/perico.avif", text: "Servicios que nacen en Perico y pasan por Jujuy." },
  ],

  // fotos de la grilla animada (la cantidad debe ser múltiplo de 3: 6, 9, 12 o 15)
  gallery: [
    { src: "/img/tilcara.avif", caption: "Tilcara" },
    { src: "/img/humahuaca.avif", caption: "Humahuaca" },
    { src: "/img/laquiaca.avif", caption: "La Quiaca" },
    { src: "/img/bus-negro.avif", caption: "Nuestra flota" },
    { src: "/img/terminal-jujuy.avif", caption: "Jujuy" },
    { src: "/img/abrapampa.avif", caption: "Abra Pampa" },
    { src: "/img/perico.avif", caption: "Perico" },
    { src: "/img/bus-ruta.avif", caption: "Ruta 9" },
    { src: "/img/tilcara.avif", caption: "Quebrada", zoom: true },
  ],

  boardImage: { src: "/img/bus-negro.avif", alt: "Ómnibus Panamericano negro y amarillo" },

  boleterias: [
    { name: "San Salvador de Jujuy", tel: "388 464-0178", sub: "Terminal · Puesto del Marqués 605" },
    { name: "Tilcara", tel: "388 464-0179" },
    { name: "Humahuaca", tel: "388 464-0180" },
    { name: "Abra Pampa", tel: "388 464-0181" },
    { name: "La Quiaca", tel: "388 508-7661" },
    { name: "Iruya", tel: "387 571-8801" },
  ],

  faq: [
    ["¿Salen todos los días?", "Sí. Operamos de lunes a domingo, incluidos feriados. En feriados y Carnaval las frecuencias pueden variar: consultalo antes de viajar."],
    ["¿Cuánto equipaje puedo llevar?", "Un bolso de mano de hasta 5 kg en la butaca y, en bodega, un bulto de hasta 75 × 50 cm y 30 kg. El exceso se cobra según tarifa de encomiendas."],
    ["¿Puedo viajar con mi mascota?", "No. Por norma del servicio no se permite viajar con animales."],
    ["¿Qué necesita un menor para viajar?", "De 0 a 4 años viajan sin butaca, solo con seguro. Desde los 5 pagan pasaje completo. Hasta 12 años siempre con madre, padre, representante legal o persona autorizada. De 13 a 17, acompañados o con autorización de un representante legal."],
    ["¿Qué documento me piden?", "DNI tarjeta, libreta celeste (también en versión digital) o pasaporte. No se aceptan DNI escritos a mano, constancias en trámite ni documentos deteriorados."],
    ["¿Cuánto me devuelven si cancelo?", "Se retiene el 30 % si cancelás con menos de 24 h, 20 % con menos de 48 h y 10 % con más de 48 h. Los pasajes vencidos no se reintegran."],
    ["¿Con cuánta anticipación llego?", "Te recomendamos presentarte entre 30 y 45 minutos antes de la salida."],
    ["¿Tienen WiFi?", "Sí, a bordo hay WiFi Starlink, aire acondicionado y calefacción, pantallas rebatibles, luz de lectura y puerto USB."],
  ],

  services: [
    ["WiFi", "Starlink a bordo"],
    ["Clima", "Aire acondicionado y calefacción"],
    ["Pantallas", "Rebatibles, con audio y video"],
    ["Energía", "Puerto USB en la butaca"],
    ["Luz", "De lectura individual"],
    ["Horarios", "Todos los días, feriados incluidos"],
  ],

  // Perfil de la Ruta 9: altura aproximada (m s. n. m.) y kilometraje aproximado desde Jujuy. Validar antes de publicar.
  journey: [
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
  ],
};
