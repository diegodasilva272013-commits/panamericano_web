---
name: Panamericano de Jujuy · Gestión (ERP)
description: Hoja de carta del norte jujeño: papel, tinta y el rojo del logo como la ruta.
colors:
  route-red: "#e8261f"
  route-red-hi: "#ff4a3f"
  ink: "#1c1813"
  paper: "#ece5d3"
  sheet: "#f6f1e3"
  sheet-2: "#efe8d6"
  margin-black: "#0d0c0b"
  muted: "#5f574a"
  ok: "#146c36"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(30px, 3.4vw, 44px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  sheet: "4px"
  control: "8px"
spacing:
  sm: "12px"
  md: "22px"
  lg: "44px"
components:
  button-primary:
    backgroundColor: "{colors.route-red}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    height: "44px"
  panel:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "22px 24px"
---

## Overview
El ERP se lee como una hoja de carta topográfica del norte de Jujuy: papel cálido con curvas de nivel apenas visibles, tinta casi negra y el rojo del logo como la única línea fuerte (la ruta). Se trabaja dentro de un marco con regla graduada. El menú es el margen negro de la hoja y dibuja una línea de colectivo: cada sección es una parada.

## Colors
Estrategia restringida: neutros de papel y tinta más un solo acento. El rojo (`route-red`) marca lo activo, lo urgente y la acción principal; nunca decora. Verde solo para "bien", ocre para advertencias. Contraste de texto ≥4.5:1.

## Typography
Bricolage Grotesque para títulos y cifras; Hanken Grotesk para el resto. Cifras tabulares. Rótulos en mayúsculas con tracking 0.08em solo como etiquetas de dato (nunca encima de un título).

## Layout
Menú negro de 288 px + hoja enmarcada (máx. 1480 px). Cada pantalla: título, filete con tramo rojo, contenido. Las cifras van en leyenda de plano (rótulo · puntos guía · valor), no en tarjetas. En celular el menú se pliega y la leyenda pasa a una columna.

## Elevation & Depth
Plano: sin sombras. La jerarquía sale de filetes (1px tinta al 42%, 2px tinta para encabezados de tabla) y del marco de la hoja. Textura: curvas de nivel (`/img/curvas-nivel.svg`, generadas con código, semilla fija 965, sin fuente externa) bajo una veladura de papel.

## Shapes
Esquinas casi rectas (4px en recuadros, 8px en controles), como un plano. Las paradas del menú son círculos; los grupos, rombos.

## Components
Menú: línea vertical con paradas; la parada activa se rellena de rojo. Cifras: leyenda con puntos guía. Recuadros: borde fino de tinta, sin sombra. Botón primario rojo; secundario con contorno de tinta que se invierte al pasar el mouse. Tablas: encabezado de tinta con filete grueso, filas con filete fino.

## Do's and Don'ts
- Sí: usar el rojo solo para lo activo, lo urgente y la acción principal.
- Sí: filetes en lugar de sombras; cifras en leyenda.
- No: tarjetas blancas iguales con número grande.
- No: sombras, degradados en texto ni un segundo acento de color.
