-- Run once in an existing Supabase Free project SQL editor.
-- No secret/service_role key belongs in application code.
create table if not exists public.lunch_sessions (
  id uuid primary key default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '1 hour')
);
create table if not exists public.lunch_votes (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.lunch_sessions(id),
  team text not null check (char_length(team) between 1 and 24),
  menu text not null check (char_length(menu) between 1 and 20),
  voter text not null check (voter ~ '^[a-zA-Z0-9-]{16,64}$'),
  day date not null default ((now() at time zone 'Asia/Seoul')::date),
  created_at timestamptz not null default now(),
  unique(session_id, team, day, voter)
);
alter table public.lunch_sessions enable row level security;
alter table public.lunch_votes enable row level security;
revoke all on public.lunch_sessions, public.lunch_votes from anon, authenticated;
create or replace function public.lunch_vote(p_session uuid, p_team text, p_menu text, p_voter text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.lunch_sessions where id=p_session and expires_at>now()) then
    raise exception 'Session expired';
  end if;
  insert into public.lunch_votes(session_id,team,menu,voter) values(p_session,trim(p_team),trim(p_menu),p_voter);
end $$;
create or replace function public.lunch_top(p_session uuid, p_team text)
returns table(menu text, count bigint) language sql security definer set search_path = '' as $$
  select v.menu, count(*) from public.lunch_votes v
  join public.lunch_sessions s on s.id=v.session_id
  where s.id=p_session and s.expires_at>now() and v.team=p_team
    and v.day=(now() at time zone 'Asia/Seoul')::date
  group by v.menu order by count(*) desc, v.menu asc limit 5;
$$;
revoke all on function public.lunch_vote(uuid,text,text,text) from public;
revoke all on function public.lunch_top(uuid,text) from public;
grant execute on function public.lunch_vote(uuid,text,text,text) to anon;
grant execute on function public.lunch_top(uuid,text) to anon;
-- Immediately before starting the final one-hour session, execute:
-- insert into public.lunch_sessions default values returning id, expires_at;
-- Put the returned id in SUPABASE_SESSION_ID in the untracked .env file.
