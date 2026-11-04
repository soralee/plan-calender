-- Shared household categories. Run once in Supabase SQL Editor after deploying the category-enabled app.
-- Existing entries.category text is preserved and backfilled into calendar_categories.

create table if not exists public.calendar_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  color text not null default '#b6b9ad' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_categories_household_id_id_unique unique (household_id, id),
  constraint calendar_categories_household_name_unique unique (household_id, name)
);

create index if not exists calendar_categories_household_sort_idx
  on public.calendar_categories (household_id, sort_order, name);

alter table public.entries add column if not exists category_id uuid;

-- Starter categories for each calendar; legacy category names are added below without truncation.
insert into public.calendar_categories (household_id, name, color, sort_order)
select h.id, seed.name, seed.color, seed.sort_order
from public.households h
cross join (values
  ('일상', '#d79ca8', 0), ('집', '#91ad91', 1), ('금융', '#9d97c7', 2),
  ('이사', '#c99c7c', 3), ('개인', '#819cc3', 4), ('기타', '#b6b9ad', 5)
) as seed(name, color, sort_order)
where not exists (select 1 from public.calendar_categories c where c.household_id=h.id and c.name=seed.name);

insert into public.calendar_categories (household_id, name, color, sort_order)
select distinct e.household_id, trim(coalesce(nullif(e.category, ''), '기타')), '#b6b9ad',
       10 + dense_rank() over (partition by e.household_id order by trim(coalesce(nullif(e.category, ''), '기타')))
from public.entries e
where not exists (
  select 1 from public.calendar_categories c
  where c.household_id=e.household_id and c.name=trim(coalesce(nullif(e.category, ''), '기타'))
);

update public.entries e
set category_id=c.id
from public.calendar_categories c
where c.household_id=e.household_id
  and c.name=trim(coalesce(nullif(e.category, ''), '기타'))
  and e.category_id is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='entries_household_category_fk') then
    alter table public.entries add constraint entries_household_category_fk
      foreign key (household_id, category_id)
      references public.calendar_categories (household_id, id) on delete restrict;
  end if;
end $$;

alter table public.calendar_categories enable row level security;

drop policy if exists "members can read household categories" on public.calendar_categories;
create policy "members can read household categories" on public.calendar_categories for select to authenticated
using (exists (select 1 from public.household_members hm where hm.household_id=calendar_categories.household_id and hm.user_id=auth.uid()));

drop policy if exists "members can add household categories" on public.calendar_categories;
create policy "members can add household categories" on public.calendar_categories for insert to authenticated
with check (exists (select 1 from public.household_members hm where hm.household_id=calendar_categories.household_id and hm.user_id=auth.uid()));

drop policy if exists "members can update household categories" on public.calendar_categories;
create policy "members can update household categories" on public.calendar_categories for update to authenticated
using (exists (select 1 from public.household_members hm where hm.household_id=calendar_categories.household_id and hm.user_id=auth.uid()))
with check (exists (select 1 from public.household_members hm where hm.household_id=calendar_categories.household_id and hm.user_id=auth.uid()));

-- Backward compatibility for app versions that still only send entries.category text.
create or replace function public.sync_entry_category_id()
returns trigger language plpgsql security definer set search_path=public as $$
declare resolved_category public.calendar_categories%rowtype; legacy_name text;
begin
  if new.category_id is not null then
    select * into resolved_category from public.calendar_categories where household_id=new.household_id and id=new.category_id;
    if not found then raise exception '선택한 카테고리를 찾을 수 없습니다.'; end if;
    new.category:=resolved_category.name; return new;
  end if;
  legacy_name:=trim(coalesce(nullif(new.category,''),'기타'));
  select * into resolved_category from public.calendar_categories where household_id=new.household_id and name=legacy_name;
  if not found then
    insert into public.calendar_categories(household_id,name,color,sort_order)
    values(new.household_id,legacy_name,'#b6b9ad',coalesce((select max(sort_order)+1 from public.calendar_categories where household_id=new.household_id),0))
    returning * into resolved_category;
  end if;
  new.category_id:=resolved_category.id; new.category:=resolved_category.name; return new;
end; $$;

drop trigger if exists entries_sync_category_id on public.entries;
create trigger entries_sync_category_id before insert or update of category,category_id,household_id on public.entries
for each row execute function public.sync_entry_category_id();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='calendar_categories') then
    alter publication supabase_realtime add table public.calendar_categories;
  end if;
exception when undefined_object then null;
end $$;
