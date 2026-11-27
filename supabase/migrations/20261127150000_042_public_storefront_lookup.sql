-- Public, read-only storefront lookup. Exposes only fields needed by the public shop.
create or replace function public.get_public_storefront(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with matched_store as (
    select
      s.id, s.slug, s.alias, s.name, s.tagline, s.accent, s.theme, s.plan,
      s.status, s.custom_domain, s.domain_verified, s.allow_small_small
    from public.stores s
    where
      s.status <> 'suspended'
      and (
        (position('.' in lower(coalesce(p_key, ''))) > 0
          and lower(s.custom_domain) = lower(p_key)
          and s.domain_verified = true)
        or
        (position('.' in lower(coalesce(p_key, ''))) = 0
          and (lower(s.slug) = lower(p_key) or lower(s.alias) = lower(p_key)))
      )
    order by case when lower(s.slug) = lower(p_key) then 0 else 1 end
    limit 1
  )
  select jsonb_build_object(
    'store', jsonb_build_object(
      'id', s.id,
      'slug', s.slug,
      'alias', s.alias,
      'name', s.name,
      'tagline', s.tagline,
      'accent', s.accent,
      'theme', s.theme,
      'plan', s.plan,
      'status', s.status,
      'custom_domain', case when s.domain_verified then s.custom_domain else null end,
      'allow_small_small', s.allow_small_small
    ),
    'listings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'slug', p.slug,
          'markup_type', sp.markup_type,
          'markup_value', sp.markup_value
        ) order by sp.sort, sp.created_at
      )
      from public.store_products sp
      join public.products p on p.id = sp.product_id
      where sp.store_id = s.id
        and sp.active = true
        and p.status = 'active'
    ), '[]'::jsonb)
  )
  from matched_store s;
$$;

revoke all on function public.get_public_storefront(text) from public;
grant execute on function public.get_public_storefront(text) to anon, authenticated, service_role;
