-- 우리의 캘린더: 공유 데이터베이스 및 접근 제어
-- Supabase SQL Editor에서 이 파일 전체를 실행하세요.

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  login_name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists households_login_name_unique
  on public.households (lower(login_name));

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.entries (
  household_id uuid not null references public.households(id) on delete cascade,
  id text not null,
  title text not null,
  date date not null,
  time text,
  kind text not null check (kind in ('일정', '할 일')),
  assignee text not null check (assignee in ('나', '배우자', '함께')),
  category text not null default '기타',
  done boolean not null default false,
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (household_id, id)
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.entries enable row level security;

drop policy if exists "members can read their household" on public.households;
create policy "members can read their household"
on public.households for select to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = households.id and hm.user_id = auth.uid()
));

drop policy if exists "users can read their own membership" on public.household_members;
create policy "users can read their own membership"
on public.household_members for select to authenticated
using (user_id = auth.uid());

drop policy if exists "members can read entries" on public.entries;
create policy "members can read entries"
on public.entries for select to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = entries.household_id and hm.user_id = auth.uid()
));

drop policy if exists "members can add entries" on public.entries;
create policy "members can add entries"
on public.entries for insert to authenticated
with check (exists (
  select 1 from public.household_members hm
  where hm.household_id = entries.household_id and hm.user_id = auth.uid()
));

drop policy if exists "members can update entries" on public.entries;
create policy "members can update entries"
on public.entries for update to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = entries.household_id and hm.user_id = auth.uid()
))
with check (exists (
  select 1 from public.household_members hm
  where hm.household_id = entries.household_id and hm.user_id = auth.uid()
));

drop policy if exists "members can delete entries" on public.entries;
create policy "members can delete entries"
on public.entries for delete to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = entries.household_id and hm.user_id = auth.uid()
));

-- 계정 생성 후 해당 로그인 이름으로 공유 캘린더를 한 개 만든다.
create or replace function public.create_household(p_name text, p_login_name text)
returns table (household_id uuid, household_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household_id uuid;
  clean_login text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  clean_login := lower(trim(p_login_name));
  if clean_login = '' or length(clean_login) > 40 then
    raise exception '캘린더 이름은 1~40자로 입력해 주세요.';
  end if;

  if exists (
    select 1 from public.household_members hm where hm.user_id = auth.uid()
  ) then
    raise exception '이미 연결된 캘린더가 있습니다.';
  end if;

  insert into public.households (name, login_name, created_by)
  values (coalesce(nullif(trim(p_name), ''), clean_login), clean_login, auth.uid())
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, auth.uid(), 'owner');

  return query
    select h.id, h.name from public.households h where h.id = new_household_id;
end;
$$;

revoke all on function public.create_household(text, text) from public;
grant execute on function public.create_household(text, text) to authenticated;

-- 실시간 구독이 이미 등록되어 있지 않을 때만 추가한다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
exception when undefined_object then
  null;
end $$;
