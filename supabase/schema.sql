-- =====================================================================================
--  PANAMERICANO · Panel de administración · esquema de la base (Supabase)
--  Pegar TODO este archivo en: Supabase > SQL Editor > New query > Run.
--  Se puede volver a ejecutar sin romper nada.
-- =====================================================================================

-- 1) ADMINISTRADORES --------------------------------------------------------------------
-- Solo los usuarios que estén en esta tabla pueden editar la web. Que alguien tenga una cuenta no alcanza.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "cada admin ve su fila" on public.admins;
create policy "cada admin ve su fila" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable
as $$ select exists (select 1 from public.admins where user_id = auth.uid()); $$;
grant execute on function public.is_admin() to anon, authenticated;

-- 2) CONTENIDO DE LA WEB (un único documento "main") -----------------------------------
create table if not exists public.site_content (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.site_content enable row level security;

drop policy if exists "la web lee el contenido" on public.site_content;
create policy "la web lee el contenido" on public.site_content for select to anon, authenticated using (true);

drop policy if exists "admin crea contenido" on public.site_content;
create policy "admin crea contenido" on public.site_content for insert to authenticated with check (public.is_admin());

drop policy if exists "admin actualiza contenido" on public.site_content;
create policy "admin actualiza contenido" on public.site_content for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3) HISTORIAL (cada vez que se guarda, la versión anterior queda archivada; se conservan las últimas 30) ----
create table if not exists public.site_content_history (
  id         bigint generated always as identity primary key,
  content_id text not null,
  data       jsonb not null,
  saved_at   timestamptz not null default now(),
  saved_by   uuid
);
alter table public.site_content_history enable row level security;
drop policy if exists "admin ve el historial" on public.site_content_history;
create policy "admin ve el historial" on public.site_content_history for select to authenticated using (public.is_admin());

create or replace function public.keep_history()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.site_content_history (content_id, data, saved_by) values (old.id, old.data, old.updated_by);
  delete from public.site_content_history
   where content_id = old.id
     and id not in (select id from public.site_content_history where content_id = old.id order by id desc limit 30);
  return new;
end;
$$;
drop trigger if exists site_content_history_trg on public.site_content;
create trigger site_content_history_trg before update on public.site_content for each row execute function public.keep_history();

-- 4) ARCHIVOS: fotos y cuadros del hero -------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('site-media',  'site-media',  true, 8388608, array['image/webp','image/jpeg','image/png','image/avif']),
  ('hero-frames', 'hero-frames', true, 2097152, array['image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "archivos publicos de la web" on storage.objects;
create policy "archivos publicos de la web" on storage.objects for select using (bucket_id in ('site-media', 'hero-frames'));

drop policy if exists "admin sube archivos" on storage.objects;
create policy "admin sube archivos" on storage.objects for insert to authenticated
  with check (bucket_id in ('site-media', 'hero-frames') and public.is_admin());

drop policy if exists "admin reemplaza archivos" on storage.objects;
create policy "admin reemplaza archivos" on storage.objects for update to authenticated
  using (bucket_id in ('site-media', 'hero-frames') and public.is_admin())
  with check (bucket_id in ('site-media', 'hero-frames') and public.is_admin());

drop policy if exists "admin borra archivos" on storage.objects;
create policy "admin borra archivos" on storage.objects for delete to authenticated
  using (bucket_id in ('site-media', 'hero-frames') and public.is_admin());

-- 5) DARTE PERMISO DE ADMINISTRADOR -----------------------------------------------------
-- Primero creá tu usuario en: Authentication > Users > Add user (email + contraseña).
-- Después cambiá el email de abajo por el tuyo, quitá los dos guiones del principio y ejecutá SOLO esa sentencia:
--
-- insert into public.admins (user_id, email) select id, email from auth.users where email = 'tu-email@ejemplo.com' on conflict do nothing;
--
-- Para agregar a otra persona, repetí la sentencia con su email (después de crear su usuario).
