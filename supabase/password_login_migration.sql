-- 이메일/회원가입 없이 캘린더 이름 + 비밀번호로 접근하는 인증 구조
-- 기존 households/entries 데이터는 유지합니다. 기존 Auth 유저를 삭제하기 전에
-- 현재 로그인된 기존 계정에서 migrate_household_password RPC를 호출해야 합니다.

create extension if not exists pgcrypto;

alter table public.households add column if not exists password_hash text;

-- Auth 유저 삭제가 캘린더와 일정을 삭제하지 않도록 참조를 SET NULL로 변경
alter table public.households alter column created_by drop not null;
alter table public.entries alter column created_by drop not null;

do $$
declare c record;
begin
  for c in
    select conname, conrelid::regclass as rel
    from pg_constraint
    where contype = 'f'
      and conrelid in ('public.households'::regclass, 'public.entries'::regclass)
      and confrelid = 'auth.users'::regclass
      and (
        pg_get_constraintdef(oid) like '%(created_by)%'
      )
  loop
    execute format('alter table %s drop constraint %I', c.rel, c.conname);
  end loop;
end $$;

alter table public.households
  add constraint households_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.entries
  add constraint entries_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- 기존 로그인 세션(현재 계정)으로 최초 비밀번호 해시를 등록합니다.
create or replace function public.migrate_household_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if p_password is null or length(p_password) < 8 then
    raise exception '비밀번호는 8자 이상이어야 합니다.';
  end if;
  select household_id into target_id
  from public.household_members where user_id = auth.uid() limit 1;
  if target_id is null then raise exception '연결된 캘린더를 찾을 수 없습니다.'; end if;
  update public.households set password_hash = crypt(p_password, gen_salt('bf'))
  where id = target_id;
end;
$$;

-- 익명 Auth 세션이 캘린더 이름과 비밀번호를 검증하고 해당 캘린더 멤버가 됩니다.
create or replace function public.login_household(p_login_name text, p_password text)
returns table (household_id uuid, household_name text, login_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare target public.households%rowtype;
begin
  if auth.uid() is null then raise exception '익명 세션을 먼저 생성해 주세요.'; end if;
  if p_login_name is null or p_password is null then raise exception '이름과 비밀번호를 입력해 주세요.'; end if;

  select * into target from public.households h
  where lower(h.login_name) = lower(trim(p_login_name))
  limit 1;

  if target.id is null or target.password_hash is null
     or target.password_hash <> crypt(p_password, target.password_hash) then
    raise exception '캘린더 이름 또는 비밀번호가 올바르지 않습니다.';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (target.id, auth.uid(), 'member')
  on conflict on constraint household_members_pkey do nothing;

  return query select target.id, target.name, target.login_name;
end;
$$;

create or replace function public.update_household_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if p_password is null or length(p_password) < 8 then
    raise exception '비밀번호는 8자 이상이어야 합니다.';
  end if;
  select household_id into target_id from public.household_members
  where user_id = auth.uid() limit 1;
  if target_id is null then raise exception '연결된 캘린더를 찾을 수 없습니다.'; end if;
  update public.households set password_hash = crypt(p_password, gen_salt('bf'))
  where id = target_id;
end;
$$;

revoke all on function public.migrate_household_password(text) from public;
revoke all on function public.login_household(text, text) from public;
revoke all on function public.update_household_password(text) from public;
grant execute on function public.migrate_household_password(text) to authenticated;
grant execute on function public.login_household(text, text) to authenticated;
grant execute on function public.update_household_password(text) to authenticated;

-- 로그인 이름 조회 RPC는 새 인증 흐름에서 사용하지 않습니다.


-- 새 캘린더 등록: 현재 익명 로그인 세션을 새 캘린더의 owner로 연결합니다.
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

  return query select h.id, h.name, h.login_name
    from public.households h where h.id = new_id;
end;
$$;

-- 현재 세션이 연결된 캘린더만, 해당 캘린더 비밀번호를 확인한 뒤 삭제합니다.
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
