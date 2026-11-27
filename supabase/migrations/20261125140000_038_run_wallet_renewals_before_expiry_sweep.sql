-- Run any due wallet renewal before the existing three-day expiry/grace-period downgrade.
create or replace function public.expire_store_plans()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r record; n int := 0;
begin
  perform public.process_due_store_subscription_renewals();
  for r in
    select id from public.stores
    where plan <> 'free' and plan_renews_at < now() - interval '3 days'
  loop
    perform public.set_store_plan(r.id, 'free', 0);
    n := n + 1;
  end loop;
  return n;
end
$$;