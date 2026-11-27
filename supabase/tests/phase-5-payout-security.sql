-- Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase-5-payout-security.sql
-- Read-only assertions; safe to run against a local/test database or production.
do $test$
declare
  v_definition text;
begin
  if has_column_privilege('anon', 'public.stores', 'account_number', 'UPDATE')
     or has_column_privilege('anon', 'public.stores', 'account_name', 'UPDATE')
     or has_column_privilege('anon', 'public.stores', 'bank_name', 'UPDATE')
     or has_column_privilege('authenticated', 'public.stores', 'account_number', 'UPDATE')
     or has_column_privilege('authenticated', 'public.stores', 'account_name', 'UPDATE')
     or has_column_privilege('authenticated', 'public.stores', 'bank_name', 'UPDATE')
     or has_column_privilege('authenticated', 'public.stores', 'payout_bank_code', 'UPDATE')
     or has_column_privilege('authenticated', 'public.stores', 'payout_account_verified_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.stores', 'paystack_recipient_code', 'UPDATE') then
    raise exception 'Payout bank columns are still writable by public client roles';
  end if;

  if not has_column_privilege('service_role', 'public.stores', 'account_number', 'UPDATE') then
    raise exception 'service_role must retain the ability to save verified payout accounts';
  end if;

  v_definition := pg_get_functiondef(
    'public.record_paystack_seller_payout_event(text,text,bigint,text,jsonb)'::regprocedure
  );

  if position('p.transfer_status = ''reversed''' in v_definition) = 0
     or position('p.transfer_status = ''failed''' in v_definition) = 0
     or position('p_amount_kobo is null' in lower(v_definition)) = 0
     or position('p_currency is distinct from ''NGN''' in v_definition) = 0 then
    raise exception 'Paystack payout event handler is missing terminal-state or amount/currency guards';
  end if;
end
$test$;
