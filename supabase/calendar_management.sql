-- Run this file once in Supabase SQL Editor after deploying the calendar management UI.

create or replace function public.create_household_with_password(
  p_name text,
  p_login_name text,
  p_password text
)
returns table (household_id uuid, household_name text, login_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id uuid;
  clean_name text := trim(coalesce(p_name, ''));
  clean_login text := lower(trim(coalesce(p_login_name, '')));
begin
  if auth.uid() is null then
    raise exception '먼저 로그인해 주세요.';
  end if;
  if length(clean_name) < 2 or length(clean_name) > 40 then
    raise exception '캘린더 이름은 2~40자로 입력해 주세요.';
  end if;
  if length(clean_login) < 2 or length(clean_login) > 40 then
    raise exception '로그인 이름은 2~40자로 입력해 주세요.';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception '비밀번호는 8자 이상이어야 합니다.';
  end if;
  if exists (
    select 1 from public.households h
    where lower(h.login_name) = clean_login
  ) then
    raise exception '이미 사용 중인 캘린더 이름입니다. 다른 이름을 입력해 주세요.';
  end if;

  insert into public.households (name, login_name, created_by, password_hash)
  values (clean_name, clean_login, auth.uid(), crypt(p_password, gen_salt('bf')))
  returning id into new_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_id, auth.uid(), 'owner');

  return query
    select h.id, h.name, h.login_name
    from public.households h where h.id = new_id;
end;
$$;

create or replace function public.delete_household_with_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_id uuid;
  saved_hash text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select h.id, h.password_hash
    into target_id, saved_hash
  from public.households h
  join public.household_members hm on hm.household_id = h.id
  where hm.user_id = auth.uid()
  order by hm.created_at desc
  limit 1;

  if target_id is null then
    raise exception '삭제할 캘린더 연결을 찾을 수 없습니다.';
  end if;
  if saved_hash is null or p_password is null
     or saved_hash <> crypt(p_password, saved_hash) then
    raise exception '비밀번호가 올바르지 않습니다.';
  end if;

  delete from public.households h where h.id = target_id;
end;
$$;

revoke all on function public.create_household_with_password(text, text, text) from public;
revoke all on function public.delete_household_with_password(text) from public;
grant execute on function public.create_household_with_password(text, text, text) to authenticated;
grant execute on function public.delete_household_with_password(text) to authenticated;


-- Shared display names for the two people using a household calendar.
alter table public.households
  add column if not exists member_one_name text not null default '나',
  add column if not exists member_two_name text not null default '배우자';

create or replace function public.update_household_member_names(
  p_member_one_name text,
  p_member_two_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  clean_one text := trim(coalesce(p_member_one_name, ''));
  clean_two text := trim(coalesce(p_member_two_name, ''));
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if length(clean_one) < 1 or length(clean_one) > 20
     or length(clean_two) < 1 or length(clean_two) > 20 then
    raise exception '두 사람의 이름은 1~20자로 입력해 주세요.';
  end if;
  if lower(clean_one) = lower(clean_two) then
    raise exception '두 사람의 이름은 서로 다르게 입력해 주세요.';
  end if;
  select hm.household_id into target_id
  from public.household_members hm
  where hm.user_id = auth.uid()
  order by hm.created_at desc
  limit 1;
  if target_id is null then
    raise exception '공유 캘린더를 찾을 수 없습니다.';
  end if;
  update public.households
  set member_one_name = clean_one, member_two_name = clean_two
  where id = target_id;
end;
$$;

revoke all on function public.update_household_member_names(text, text) from public;
grant execute on function public.update_household_member_names(text, text) to authenticated;
