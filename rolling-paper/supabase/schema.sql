-- 우리 팀 롤링페이퍼: run once in the existing Supabase Free project's SQL Editor.
-- Only the publishable(anon) key is used by the app. No secret/service_role key.
-- Tables are never exposed directly: every read/write goes through RPCs that
-- require the secret session id held only by the running Docker container.

create schema if not exists rp_private;
revoke all on schema rp_private from public;
grant usage on schema rp_private to anon;

create table if not exists rp_private.config (
  id boolean primary key default true check (id),
  bootstrap_hash text not null
);
-- Replaced by tools/render_sql.py with sha256(BOOTSTRAP_SECRET from the local .env).
insert into rp_private.config(bootstrap_hash) values ('__BOOTSTRAP_HASH__')
on conflict (id) do update set bootstrap_hash = excluded.bootstrap_hash;

create table if not exists public.rp_sessions (
  id uuid primary key default gen_random_uuid(),
  origin text check (origin ~ '^https://[a-z0-9-]+\.trycloudflare\.com$'),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.rp_boards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]{8}$'),
  title text not null check (char_length(title) between 1 and 40),
  recipient text not null default '' check (char_length(recipient) <= 20),
  theme text not null default 'birthday'
    check (theme in ('birthday','farewell','welcome','graduation','thanks','feedback')),
  deadline timestamptz not null,
  secret boolean not null default false,
  admin_hash text not null check (admin_hash ~ '^[0-9a-f]{64}$'),
  rev bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.rp_notes (
  id bigint generated always as identity primary key,
  board_id uuid not null references public.rp_boards(id) on delete cascade,
  author text not null default '익명' check (char_length(author) between 1 and 12),
  message text not null check (char_length(message) between 1 and 100),
  color text not null default 'yellow' check (color in ('yellow','pink','mint','blue')),
  sticker text not null default '' check (sticker in ('','cake','party','heart','star','flower','clap','fire','coffee')),
  font text not null default 'pen' check (font in ('pen','round','print')),
  photo_path text check (photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{32}\.jpg$'),
  hearts integer not null default 0 check (hearts >= 0),
  owner_hash text not null check (owner_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists rp_notes_board_idx on public.rp_notes(board_id, id);

create table if not exists public.rp_hearts (
  note_id bigint not null references public.rp_notes(id) on delete cascade,
  voter_hash text not null check (voter_hash ~ '^[0-9a-f]{64}$'),
  primary key (note_id, voter_hash)
);

alter table public.rp_sessions enable row level security;
alter table public.rp_boards enable row level security;
alter table public.rp_notes enable row level security;
alter table public.rp_hearts enable row level security;
revoke all on public.rp_sessions, public.rp_boards, public.rp_notes, public.rp_hearts from anon, authenticated;
revoke all on rp_private.config from anon, authenticated;

-- Internal helpers -----------------------------------------------------------
create or replace function rp_private.active(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.rp_sessions where id = p_session and expires_at > now());
$$;

create or replace function rp_private.check(p_session uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not rp_private.active(p_session) then
    raise exception 'session closed' using errcode = 'P0001', hint = 'closed';
  end if;
end $$;

-- Storage INSERT policy helper: the first folder must be the live session id.
create or replace function rp_private.upload_ok(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.rp_sessions
    where id::text = split_part(p_name, '/', 1) and expires_at > now()
  );
$$;

create or replace function rp_private.note_json(n public.rp_notes, p_viewer text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'author', n.author, 'message', n.message, 'color', n.color,
    'sticker', n.sticker, 'font', n.font, 'photo', n.photo_path is not null,
    'hearts', n.hearts, 'createdAt', n.created_at,
    'mine', n.owner_hash = p_viewer,
    'hearted', exists(select 1 from public.rp_hearts h where h.note_id = n.id and h.voter_hash = p_viewer)
  );
$$;

create or replace function rp_private.board_json(b public.rp_boards)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'code', b.code, 'title', b.title, 'recipient', b.recipient,
    'theme', b.theme, 'deadline', b.deadline, 'secret', b.secret, 'rev', b.rev,
    'closed', b.deadline <= now(),
    'count', (select count(*) from public.rp_notes n where n.board_id = b.id),
    'hearts', (select coalesce(sum(hearts), 0) from public.rp_notes n where n.board_id = b.id)
  );
$$;

create or replace function rp_private.board_for(p_session uuid, p_code text)
returns public.rp_boards language plpgsql stable security definer set search_path = '' as $$
declare b public.rp_boards;
begin
  perform rp_private.check(p_session);
  select * into b from public.rp_boards where code = p_code;
  if not found then raise exception 'board not found' using errcode = 'P0002'; end if;
  return b;
end $$;

-- Session lifecycle (container only) ------------------------------------------
create or replace function public.rp_start_session(p_secret text, p_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.rp_sessions;
begin
  if p_secret is null or encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
     <> (select bootstrap_hash from rp_private.config) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- One live service window at a time, never longer than one hour.
  update public.rp_sessions set expires_at = now() where expires_at > now();
  insert into public.rp_sessions(expires_at)
  values (now() + make_interval(secs => least(3600, greatest(60, p_seconds))))
  returning * into s;
  return jsonb_build_object('id', s.id, 'expiresAt', s.expires_at);
end $$;

create or replace function public.rp_set_origin(p_session uuid, p_origin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform rp_private.check(p_session);
  update public.rp_sessions set origin = p_origin where id = p_session;
end $$;

create or replace function public.rp_end_session(p_session uuid)
returns void language sql security definer set search_path = '' as $$
  update public.rp_sessions set expires_at = now() where id = p_session and expires_at > now();
$$;

-- Used by the Vercel gateway to find the live container. Returns nothing when closed.
create or replace function public.rp_live()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('origin', origin, 'expiresAt', expires_at)
  from public.rp_sessions
  where expires_at > now() and origin is not null
  order by expires_at desc limit 1;
$$;

-- Boards ---------------------------------------------------------------------
create or replace function public.rp_create_board(
  p_session uuid, p_code text, p_title text, p_recipient text, p_theme text,
  p_deadline timestamptz, p_secret boolean, p_admin_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.rp_boards;
begin
  perform rp_private.check(p_session);
  if p_deadline <= now() or p_deadline > now() + interval '7 days' then
    raise exception 'invalid deadline' using errcode = '22023';
  end if;
  insert into public.rp_boards(code, title, recipient, theme, deadline, secret, admin_hash)
  values (p_code, trim(p_title), trim(coalesce(p_recipient, '')), p_theme, p_deadline, coalesce(p_secret, false), p_admin_hash)
  returning * into b;
  return rp_private.board_json(b);
end $$;

-- Secret boards hide other people's notes until the deadline.
create or replace function public.rp_get_board(p_session uuid, p_code text, p_viewer text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.rp_boards;
begin
  b := rp_private.board_for(p_session, p_code);
  return jsonb_build_object(
    'board', rp_private.board_json(b),
    'notes', coalesce((
      select jsonb_agg(rp_private.note_json(n, p_viewer) order by n.id desc)
      from public.rp_notes n
      where n.board_id = b.id
        and (not b.secret or b.deadline <= now() or n.owner_hash = p_viewer)
    ), '[]'::jsonb));
end $$;

create or replace function public.rp_pulse(p_session uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return rp_private.board_json(rp_private.board_for(p_session, p_code));
end $$;

create or replace function public.rp_set_deadline(p_session uuid, p_code text, p_admin_hash text, p_deadline timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.rp_boards;
begin
  b := rp_private.board_for(p_session, p_code);
  if b.admin_hash <> p_admin_hash then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_deadline > now() + interval '7 days' then raise exception 'invalid deadline' using errcode = '22023'; end if;
  update public.rp_boards set deadline = greatest(p_deadline, now()), rev = rev + 1
  where id = b.id returning * into b;
  return rp_private.board_json(b);
end $$;

-- Notes ----------------------------------------------------------------------
create or replace function public.rp_add_note(
  p_session uuid, p_code text, p_author text, p_message text, p_color text,
  p_sticker text, p_font text, p_photo text, p_owner text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.rp_boards; n public.rp_notes;
begin
  b := rp_private.board_for(p_session, p_code);
  if b.deadline <= now() then raise exception 'board closed' using errcode = 'P0003'; end if;
  if (select count(*) from public.rp_notes where board_id = b.id) >= 300 then
    raise exception 'board full' using errcode = 'P0004';
  end if;
  insert into public.rp_notes(board_id, author, message, color, sticker, font, photo_path, owner_hash)
  values (b.id, coalesce(nullif(trim(p_author), ''), '익명'), trim(p_message), p_color,
          coalesce(p_sticker, ''), p_font, p_photo, p_owner)
  returning * into n;
  update public.rp_boards set rev = rev + 1 where id = b.id;
  return rp_private.note_json(n, p_owner);
end $$;

create or replace function public.rp_toggle_heart(p_session uuid, p_code text, p_note bigint, p_voter text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.rp_boards; added boolean; total integer;
begin
  b := rp_private.board_for(p_session, p_code);
  if not exists(select 1 from public.rp_notes where id = p_note and board_id = b.id
                and (not b.secret or b.deadline <= now() or owner_hash = p_voter)) then
    raise exception 'note not found' using errcode = 'P0002';
  end if;
  delete from public.rp_hearts where note_id = p_note and voter_hash = p_voter;
  added := not found;
  if added then insert into public.rp_hearts(note_id, voter_hash) values (p_note, p_voter); end if;
  update public.rp_notes set hearts = greatest(0, hearts + case when added then 1 else -1 end)
  where id = p_note returning hearts into total;
  update public.rp_boards set rev = rev + 1 where id = b.id;
  return jsonb_build_object('id', p_note, 'hearts', total, 'hearted', added);
end $$;

-- The author's browser or the board admin may delete. Returns the photo path to forget.
create or replace function public.rp_delete_note(p_session uuid, p_code text, p_note bigint, p_owner text, p_admin_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.rp_boards; n public.rp_notes;
begin
  b := rp_private.board_for(p_session, p_code);
  delete from public.rp_notes
  where id = p_note and board_id = b.id
    and (owner_hash = p_owner or b.admin_hash = coalesce(p_admin_hash, ''))
  returning * into n;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.rp_boards set rev = rev + 1 where id = b.id;
  return jsonb_build_object('id', n.id);
end $$;

-- Photo lookup honours the secret-board rule.
create or replace function public.rp_photo_path(p_session uuid, p_code text, p_note bigint, p_viewer text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare b public.rp_boards;
begin
  b := rp_private.board_for(p_session, p_code);
  return (select photo_path from public.rp_notes
          where id = p_note and board_id = b.id
            and (not b.secret or b.deadline <= now() or owner_hash = p_viewer));
end $$;

create or replace function public.rp_export(p_session uuid, p_code text, p_admin_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.rp_boards;
begin
  b := rp_private.board_for(p_session, p_code);
  if b.admin_hash <> p_admin_hash then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'author', author, 'message', message, 'color', color, 'sticker', sticker,
      'photo', photo_path is not null, 'hearts', hearts, 'createdAt', created_at) order by id)
    from public.rp_notes where board_id = b.id), '[]'::jsonb);
end $$;

-- Grants: nothing by default, then only the RPC surface.
revoke all on all functions in schema rp_private from public, anon, authenticated;
grant execute on function rp_private.upload_ok(text) to anon;
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p
           join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname like 'rp\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon', f);
  end loop;
end $$;

-- Photos: Supabase Storage. Public-read bucket without a SELECT policy means
-- objects cannot be listed, only fetched by their unguessable path (which only
-- the container knows). Uploads must be inside the live session's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rp-photos', 'rp-photos', true, 716800, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 716800, allowed_mime_types = array['image/jpeg'];

drop policy if exists "rp photo upload" on storage.objects;
create policy "rp photo upload" on storage.objects for insert to anon
  with check (bucket_id = 'rp-photos' and rp_private.upload_ok(name));

select 'rolling paper schema ready' as status;
