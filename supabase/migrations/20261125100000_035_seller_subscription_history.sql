-- Phase 6: seller-visible subscription billing history.
-- Payment transactions remain server-managed; sellers can only read their own store's subscription rows.
create or replace function public.my_subscription_payment_history()
returns table (
  reference text,
  provider text,
  amount_ngn bigint,
  status text,
  created_at timestamptz,
  verified_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.reference, p.provider, p.amount_ngn, p.status, p.created_at, p.verified_at
  from public.payment_transactions p
  join public.stores s on s.id = p.store_id
  where p.purpose = 'seller_subscription'
    and s.owner_id = auth.uid()
  order by p.created_at desc
  limit 50
$$;

revoke all on function public.my_subscription_payment_history() from public, anon;
grant execute on function public.my_subscription_payment_history() to authenticated;
