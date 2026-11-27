-- Preserve public access to active storefront listings without requiring
-- anon/authenticated to have table-level SELECT on the private stores table.
-- The previous store_products SELECT policy queried public.stores directly;
-- column-only grants on stores caused PostgREST to raise permission denied.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.is_store_owner(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores s
    where s.id = p_store_id
      and s.owner_id = (select auth.uid())
  );
$$;

revoke all on function private.is_store_owner(uuid) from public;
grant execute on function private.is_store_owner(uuid) to anon, authenticated;

drop policy if exists "store products: public" on public.store_products;
create policy "store products: public"
on public.store_products
for select
to anon, authenticated
using (
  active
  or private.is_store_owner(store_id)
  or (select public.is_staff())
);

comment on function private.is_store_owner(uuid) is
  'RLS helper: checks store ownership without granting public table-level SELECT on stores.';
