# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Personal de Panamericano de Jujuy S.A. (empresa de ómnibus de pasajeros del norte de Jujuy: Quebrada, Puna, Ruta 9): administración, boletería y control de flota. Usan el ERP (`/erp`) desde la PC de la oficina y desde el celular en proporción pareja. Todas las pantallas deben ser cómodas e intuitivas; no hay una pantalla "principal". Más adelante habrá una app/vista para pasajeros (todavía no existe).

## Product Purpose
Gestión de la empresa en un solo lugar: reservas, salidas del día, pasajeros, cobros, gastos, finanzas y la flota con GPS (mapa en vivo, viajes, alertas, geocercas, vehículos, reportes). Éxito: que cada persona resuelva su tarea rápido y sin dudar, y que la información de la flota y el dinero sea confiable.

## Positioning
Es el sistema propio de una empresa de transporte jujeña: reservas + cobros + flota en vivo (receptor GPS propio) en una sola herramienta, con la marca de la empresa.

## Operating Context
Sitio en Vite (páginas /, /admin, /erp) sobre Supabase y Vercel. Flota: equipos GPS Rinho transmiten a un receptor propio (VPS); el ERP muestra la posición, velocidad, paradas y alertas. Límite de velocidad 90 km/h (configurable). Pagos online (Mercado Pago/Talo) ya integrados.

## Capabilities and Constraints
No romper la lógica existente: solo cambia lo visual. Tipografías en uso: Bricolage Grotesque (títulos) y Hanken Grotesk (texto). Idioma: español rioplatense (voseo). Accesible y legible en pantalla chica. Pendiente de definir: app de pasajeros, envío de reportes por mail, WhatsApp.

## Brand Commitments
Logo oficial de Panamericano (rojo 3D con flechas circulares, texto "PANAMERICANO DE JUJUY S.A.") en `public/img/logo-panamericano.webp` y `-sm.webp`. El rojo del logo (~#e8261f) debe mandar en el color de marca. La web pública ya quedó aprobada por el usuario con negro + rojo + papel cálido. El usuario rechaza: aspecto de plantilla/SaaS genérico, frialdad corporativa, recarga visual y perder el rojo del logo.

## Evidence on Hand
Logo (ver arriba), fotos de la flota y destinos en `public/img/`, capturas de la web aprobada. No hay testimonios ni métricas reales: no inventar.

## Product Principles
1. Cada pantalla se entiende sin explicación; lo urgente (alertas, saldos, sin señal) se ve primero.
2. Mismo lenguaje en todas las pantallas: lo conocido se repite, lo importante se destaca.
3. La marca está en los detalles del trabajo, no en el adorno.
4. Lo que se ve tiene que ser verdad: nada simulado se presenta como real.
