-- 캘린더 이름 변경을 위한 추가 SQL
-- Supabase SQL Editor에서 한 번 실행하세요.

create or replace function public.rename_household_login(p_new_login_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_login text;
  target_household_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  clean_login := trim(p_new_login_name);
  if clean_login is null or length(clean_login) < 2 or length(clean_login) > 40 then
    raise exception '캘린더 이름은 2~40자로 입력해 주세요.';
  end if;

  select hm.household_id into target_household_id
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;

  if target_household_id is null then
    raise exception '연결된 캘린더를 찾을 수 없습니다.';
  end if;

  if exists (
    select 1 from public.households h
    where lower(h.login_name) = lower(clean_login)
      and h.id <> target_household_id
  ) then
    raise exception '이미 사용 중인 캘린더 이름입니다.';
  end if;

  update public.households
  set login_name = clean_login,
      name = clean_login
  where id = target_household_id;
end;
$$;

revoke all on function public.rename_household_login(text) from public;
grant execute on function public.rename_household_login(text) to authenticated;
