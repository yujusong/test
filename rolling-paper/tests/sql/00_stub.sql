-- Minimal stand-ins for objects that exist in every Supabase project.
create role anon nologin;
create role authenticated nologin;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon;
grant insert, select on storage.objects to anon;
