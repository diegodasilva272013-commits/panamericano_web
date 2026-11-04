// Vista de mapa del viaje: el trazado en rojo, las paradas y el coche. Leaflet se carga recién cuando se abre.
let L = null;
const load = async () => { if (!L) { const m = await import("leaflet"); await import("leaflet/dist/leaflet.css"); L = m.default || m; } return L; };

export async function createMap(host) {
  const Lf = await load();
  const map = Lf.map(host, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
  Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
  let routeId = null, line = null, stopsLayer = null, bus = null, follow = true;
  map.on("dragstart", () => { follow = false; });
  const busIcon = (label, lost) => Lf.divIcon({ className: "evm-bus" + (lost ? " is-lost" : ""), html: `<span class="evm-bus__dot"></span><span class="evm-bus__t">${label}</span>`, iconSize: [18, 18], iconAnchor: [9, 9] });
  return {
    set(v, latlng) {
      if (routeId !== v.route.id) {
        routeId = v.route.id; line?.remove(); stopsLayer?.remove();
        line = Lf.polyline(v.route.line, { color: "#e8261f", weight: 5, opacity: 0.9 }).addTo(map);
        stopsLayer = Lf.layerGroup(v.route.stops.map((s) => Lf.circleMarker([s.lat, s.lng], { radius: 6, color: "#1c1813", weight: 2, fillColor: "#ece8de", fillOpacity: 1 }).bindTooltip(s.short, { permanent: false, direction: "top" }))).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [24, 24] });
      }
      stopsLayer.getLayers().forEach((m, i) => m.setStyle({ fillColor: i <= v.passed ? "#e8261f" : "#ece8de" }));
      if (!latlng) { bus?.remove(); bus = null; return; }
      const lost = v.freshness === "lost";
      if (!bus) bus = Lf.marker(latlng, { icon: busIcon(v.coach || "Colectivo", lost), keyboard: false }).addTo(map);
      else { bus.setLatLng(latlng); bus.setIcon(busIcon(v.coach || "Colectivo", lost)); }
      if (follow) map.panTo(latlng, { animate: true });
    },
    refresh() { map.invalidateSize(); },
    recenter() { follow = true; },
    destroy() { map.remove(); },
  };
}
