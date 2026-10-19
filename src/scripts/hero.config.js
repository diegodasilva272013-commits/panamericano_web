// Contenido y rutas del hero con scroll. El componente (hero-scroll.js) no tiene datos de Panamericano:
// la cantidad de cuadros y los cortes entre tramos salen de /panamericano/frames/manifest.json
// (generado por scripts/hero-frames.mjs a partir de assets-src/panamericano/sequence.json).
export const HERO = {
  base: "/panamericano/frames",
  poster: "/panamericano/hero-poster.webp",
  recorridoVh: { desktop: 760, mobile: 560 }, // largo del recorrido, en alto de pantalla
  headline: "El norte te espera",
  subheadline: "Viajes diarios a los principales destinos del norte jujeño",
  hint: "Deslizá para viajar",
  ctas: [
    { label: "Ver horarios", href: "#horarios", primary: true },
    { label: "WhatsApp", href: "https://wa.me/5493884640178", external: true },
  ],
  // una etapa por tramo de video (mismo orden que los clips)
  etapas: [
    { clip: 0, rail: "Purmamarca", title: "Purmamarca", detail: "Cerro de los Siete Colores" },
    { clip: 1, rail: "Maimará", title: "Maimará", detail: "La Paleta del Pintor" },
    { clip: 2, rail: "Humahuaca", title: "Quebrada de Humahuaca", detail: "Patrimonio de la Humanidad" },
    { clip: 3, rail: "Abra Pampa", title: "Abra Pampa", detail: "La Puna, a 3.500 m" },
    { clip: 4, rail: "La Quiaca", title: "La Quiaca", detail: "El norte del país" },
  ],
  introHasta: 0.06,      // el titular inicial se apaga hasta acá
  cierreDesde: 0.93,     // aparece el bloque de cierre (CTA + buscador)
  cuadroEstatico: 0.5,   // punto fijo con prefers-reduced-motion
  cierre: {
    title: "Llegá al norte.",
    text: "Todos los días, feriados incluidos. Desde la Terminal de San Salvador hasta La Quiaca.",
  },
};
