-- Adds private, random short referral codes without changing legacy UUID links.
-- Applied to Supabase project wicpvvypqpaljuexmczi on 2026-10-27.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  constraint referral_codes_code_format check (code ~ '^[0-9a-f]{16}$')
);

alter table private.referral_codes enable row level security;
revoke all on table private.referral_codes from public, anon, authenticated;

create or replace function public.get_my_referral_code()
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_code text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select rc.code into v_code
  from private.referral_codes as rc
  where rc.user_id = v_user_id;

  if v_code is not null then
    return v_code;
  end if;

  loop
    v_code := lower(encode(extensions.gen_random_bytes(8), 'hex'));
    begin
      insert into private.referral_codes (user_id, code)
      values (v_user_id, v_code)
      on conflict (user_id) do nothing;

      select rc.code into v_code
      from private.referral_codes as rc
      where rc.user_id = v_user_id;

      return v_code;
    exception when unique_violation then
      -- Extremely unlikely random-code collision: generate another code.
    end;
  end loop;
end;
$function$;

create or replace function public.resolve_referral_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select rc.user_id
  from private.referral_codes as rc
  where p_code ~ '^[0-9a-fA-F]{16}$'
    and rc.code = lower(p_code)
  limit 1;
$function$;

revoke all on function public.get_my_referral_code() from public, anon;
grant execute on function public.get_my_referral_code() to authenticated;

revoke all on function public.resolve_referral_code(text) from public;
grant execute on function public.resolve_referral_code(text) to anon, authenticated;
