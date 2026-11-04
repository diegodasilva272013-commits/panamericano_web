-- ============================================================================================
-- Panamericano · "En vivo" para pasajeros (/envivo)
-- Ejecutar en Supabase → SQL Editor DESPUÉS de flota.sql. Se puede volver a ejecutar sin problema.
--
-- Lo que ve el público, y nada más:
--   · el trazado y las paradas de cada servicio que tenga recorrido cargado;
--   · los viajes en curso (y los que salen en las próximas 3 horas), con el número interno del coche,
--     su última posición (solo si es de las últimas 2 horas), si está en movimiento y las paradas ya hechas.
-- Nunca: patente, IMEI, velocidad, alertas, historial ni coches que no estén haciendo un viaje.
-- Las tablas siguen cerradas al público; esto entra solo por estas dos funciones de lectura.
-- ============================================================================================

create or replace function public.public_routes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'route_id', r.route_id,
    'polyline', r.polyline,
    'stops', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'idx', s.idx, 'name', s.name, 'offset_min', s.offset_min,
        'lat', coalesce(g.lat, (g.polygon -> 0 ->> 0)::double precision),
        'lng', coalesce(g.lng, (g.polygon -> 0 ->> 1)::double precision)
      ) order by s.idx), '[]'::jsonb)
      from fleet_route_stops s left join geofences g on g.id = s.geofence_id
      where s.route_id = r.route_id)
  ) order by r.route_id), '[]'::jsonb)
  from fleet_routes r
  where jsonb_typeof(r.polyline) = 'array' and jsonb_array_length(r.polyline) >= 2;
$$;

create or replace function public.public_live()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('now', now(), 'trips', coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'route_id', t.route_id,
    'trip_time', t.trip_time,
    'status', t.status,
    'planned_at', t.planned_at,
    'started_at', t.started_at,
    'coach', v.code,
    'pos', case when t.status = 'en_curso' and st.last_time > now() - interval '2 hours' and st.lat is not null
                then jsonb_build_object('lat', st.lat, 'lng', st.lng, 'course', st.course, 'moving', coalesce(st.speed, 0) >= 5, 'at', st.last_time) end,
    'stops', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'idx', s.idx, 'status', s.status, 'arrived_at', s.arrived_at, 'departed_at', s.departed_at, 'delay_min', s.delay_min
      ) order by s.idx), '[]'::jsonb)
      from fleet_trip_stops s where s.trip_id = t.id)
  ) order by t.planned_at), '[]'::jsonb))
  from fleet_trips t
  left join vehicles v on v.id = t.vehicle_id and v.active
  left join vehicle_state st on st.vehicle_id = t.vehicle_id
  where t.status = 'en_curso'
     or (t.status = 'programado' and t.planned_at between now() - interval '20 minutes' and now() + interval '3 hours');
$$;

revoke all on function public.public_routes() from public;
revoke all on function public.public_live() from public;
grant execute on function public.public_routes() to anon, authenticated;
grant execute on function public.public_live() to anon, authenticated;
