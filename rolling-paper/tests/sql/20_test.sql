\set ON_ERROR_STOP on
-- Everything below runs as the public (anon) role, exactly like the app.
set role anon;

-- Tables are never directly reachable.
do $$ begin
  begin perform * from public.rp_notes; raise exception 'notes readable';
  exception when insufficient_privilege then null; end;
  begin perform * from public.rp_sessions; raise exception 'sessions readable';
  exception when insufficient_privilege then null; end;
  begin perform rp_private.active(gen_random_uuid()); raise exception 'helper callable';
  exception when insufficient_privilege then null; end;
end $$;

-- Wrong bootstrap secret is refused; nothing is live yet.
do $$ begin
  begin perform public.rp_start_session('wrong', 3600); raise exception 'bad secret accepted';
  exception when insufficient_privilege then null; end;
  if public.rp_live() is not null then raise exception 'live without session'; end if;
end $$;

select public.rp_start_session('test-bootstrap-secret', 99999) is not null as first_start;
-- A second start must close the first one: only one live window at a time.
select public.rp_start_session('test-bootstrap-secret', 99999)->>'id' as sid \gset
select set_config('rp.sid', :'sid', false) is not null as gset_ok;
reset role;
select count(*) = 1 as one_live, bool_and(expires_at <= now() + interval '3600 seconds') as capped
from public.rp_sessions where expires_at > now() \gset
\if :one_live
\else
  \echo 'FAIL one live session'
  select 1/0;
\endif
\if :capped
\else
  \echo 'FAIL cap'
  select 1/0;
\endif
set role anon;

select public.rp_set_origin(:'sid', 'https://abc-def.trycloudflare.com');
select (public.rp_live()->>'origin') = 'https://abc-def.trycloudflare.com' as live_ok \gset
\if :live_ok
\else
  select 1/0;
\endif

\set admin '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
\set ownerb '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'''
\set viewerc '''cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'''

select public.rp_create_board(:'sid', 'abcd2345', '지수님 생일 축하해요!', '지수', 'birthday', now() + interval '30 minutes', false, :admin) is not null;
select (public.rp_add_note(:'sid', 'abcd2345', '', '축하해요', 'pink', 'cake', 'round', null, :ownerb)->>'id')::bigint as n1 \gset
select (public.rp_add_note(:'sid', 'abcd2345', '민지', '사진', 'blue', '', 'pen',
  :'sid' || '/00000000-0000-0000-0000-000000000000/0123456789abcdef0123456789abcdef.jpg', :ownerb)->>'id')::bigint as n2 \gset

select jsonb_array_length(public.rp_get_board(:'sid', 'abcd2345', :viewerc)->'notes') = 2 as two_notes,
       (public.rp_get_board(:'sid', 'abcd2345', :viewerc)->'notes'->1->>'author') = '익명' as anon_author \gset
\if :two_notes
\else
  select 1/0;
\endif
\if :anon_author
\else
  select 1/0;
\endif

select (public.rp_toggle_heart(:'sid', 'abcd2345', :n1, :viewerc)->>'hearts')::int = 1 as h1 \gset
select (public.rp_toggle_heart(:'sid', 'abcd2345', :n1, :viewerc)->>'hearts')::int = 0 as h0 \gset
\if :h0
\else
  select 1/0;
\endif
\if :h1
\else
  select 1/0;
\endif
select (public.rp_toggle_heart(:'sid', 'abcd2345', :n1, :viewerc)->>'hearted')::boolean as hearted \gset
select (public.rp_pulse(:'sid', 'abcd2345')->>'hearts')::int = 1 as pulse_hearts \gset
\if :pulse_hearts
\else
  select 1/0;
\endif

select public.rp_photo_path(:'sid', 'abcd2345', :n2, :viewerc) like :'sid' || '/%' as photo_ok \gset
\if :photo_ok
\else
  select 1/0;
\endif

-- Permission checks (the session id is passed into DO blocks through a GUC)
do $$
declare
  sid uuid := current_setting('rp.sid')::uuid;
begin
  begin perform public.rp_delete_note(sid, 'abcd2345', 1, 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', ''); raise exception 'stranger deleted';
  exception when insufficient_privilege then null; end;
  begin perform public.rp_export(sid, 'abcd2345', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'); raise exception 'export without admin';
  exception when insufficient_privilege then null; end;
  begin perform public.rp_add_note(sid, 'abcd2345', 'x', repeat('a', 101), 'pink', '', 'pen', null, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'); raise exception 'long message';
  exception when check_violation then null; end;
  begin perform public.rp_add_note(sid, 'abcd2345', 'x', 'hi', 'pink', '', 'pen', '../../etc/passwd', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'); raise exception 'bad photo path';
  exception when check_violation then null; end;
  begin perform public.rp_get_board(gen_random_uuid(), 'abcd2345', 'x'); raise exception 'fake session';
  exception when sqlstate 'P0001' then null; end;
  begin perform public.rp_get_board(sid, 'zzzzzzzz', 'x'); raise exception 'missing board';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.rp_create_board(sid, 'abcd2346', 't', '', 'birthday', now() + interval '8 days', false, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); raise exception 'deadline too far';
  exception when sqlstate '22023' then null; end;
end $$;

-- Secret board: hidden until deadline, then revealed and locked.
select public.rp_create_board(:'sid', 'secret22', '몰래', '', 'farewell', now() + interval '10 minutes', true, :admin) is not null;
select (public.rp_add_note(:'sid', 'secret22', 'b', '비밀', 'yellow', '', 'pen', null, :ownerb)->>'id')::bigint as s1 \gset
select jsonb_array_length(public.rp_get_board(:'sid', 'secret22', :viewerc)->'notes') = 0 as hidden,
       jsonb_array_length(public.rp_get_board(:'sid', 'secret22', :ownerb)->'notes') = 1 as own_visible,
       (public.rp_pulse(:'sid', 'secret22')->>'count')::int = 1 as counted,
       public.rp_photo_path(:'sid', 'secret22', :s1, :viewerc) is null as no_photo_leak \gset
\if :hidden
\else
  select 1/0;
\endif
\if :own_visible
\else
  select 1/0;
\endif
select (public.rp_set_deadline(:'sid', 'secret22', :admin, now())->>'closed')::boolean as closed \gset
select jsonb_array_length(public.rp_get_board(:'sid', 'secret22', :viewerc)->'notes') = 1 as revealed \gset
\if :revealed
\else
  select 1/0;
\endif
do $$ begin
  perform public.rp_add_note(current_setting('rp.sid')::uuid, 'secret22', 'c', '늦음', 'yellow', '', 'pen', null, 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
  raise exception 'locked board accepted';
exception when sqlstate 'P0003' then null; end $$;

select jsonb_array_length(public.rp_export(:'sid', 'abcd2345', :admin)) = 2 as exported \gset
select (public.rp_delete_note(:'sid', 'abcd2345', :n1, :ownerb, '')->>'id')::bigint = :n1 as owner_deleted \gset
select (public.rp_delete_note(:'sid', 'abcd2345', :n2, :viewerc, :admin)->>'id')::bigint = :n2 as admin_deleted \gset
\if :admin_deleted
\else
  select 1/0;
\endif

-- Storage policy: uploads only inside the live session folder.
insert into storage.objects(bucket_id, name) values ('rp-photos', :'sid' || '/b/c.jpg');
do $$ begin
  insert into storage.objects(bucket_id, name) values ('rp-photos', gen_random_uuid()::text || '/b/c.jpg');
  raise exception 'foreign folder accepted';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into storage.objects(bucket_id, name) values ('other', current_setting('rp.sid') || '/b/c.jpg');
  raise exception 'other bucket accepted';
exception when insufficient_privilege then null; end $$;

-- Ending the session closes everything.
select public.rp_end_session(:'sid');
select public.rp_live() is null as closed_live \gset
\if :closed_live
\else
  select 1/0;
\endif
do $$ begin
  perform public.rp_pulse(current_setting('rp.sid')::uuid, 'abcd2345');
  raise exception 'closed session still works';
exception when sqlstate 'P0001' then null; end $$;
do $$ begin
  insert into storage.objects(bucket_id, name) values ('rp-photos', current_setting('rp.sid') || '/b/d.jpg');
  raise exception 'upload after close';
exception when insufficient_privilege then null; end $$;

\echo 'SQL PASS: no direct table access, bootstrap secret, single capped session, origin lookup, boards, notes, hearts, photo path, permissions, validation, secret fold/reveal/lock, export, delete, storage folder policy, session close'
