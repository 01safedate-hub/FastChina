# Phase 5 — Paystack seller payouts

## Flow

1. The existing Friday job creates payout batches from eligible seller earnings.
2. Sellers verify their Nigerian bank account through Paystack Resolve Account Number. The displayed account name must be confirmed before saving.
3. FastChina creates and stores a Paystack NUBAN transfer recipient. The recipient code and bank code remain server-side.
4. A payout batch remains pending until a Super Admin or Finance admin explicitly approves it in Admin → Dropship sellers. Approval is recorded with the reviewer and timestamp.
5. Only approved batches can be claimed by the five-minute worker. The worker assigns a stable transfer reference and initiates one NGN transfer.
6. A payout is marked paid only after the Paystack transfer verification endpoint or a signed Paystack transfer webhook confirms the final successful status and exact amount/currency.
7. Failed transfers release their payout item assignments and refund-adjustment applications for a later Friday batch. Reversed transfers are placed in staff review and are never submitted again automatically.

## Required configuration

- Keep `PAYSTACK_SECRET_KEY` in Supabase Edge Function secrets. Never expose it to the browser or commit it.
- Add a long random `PAYOUT_CRON_SECRET` to the `seller-payouts` Edge Function secrets.
- Add the exact same value to Supabase Vault under the secret name `payout_cron_secret`.
- The migration intentionally does **not** create a cron job. The project had no payout Vault secret or configured Supabase URL setting at migration time, so automatic processing remains disabled until the secrets are configured.
- After both secrets exist, create the worker schedule in the Supabase SQL Editor:
```sql
select cron.schedule(
  'fc-seller-payout-transfers',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://cczzhtlbpqyxbdbaudfo.supabase.co/functions/v1/seller-payouts',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-payout-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='payout_cron_secret' limit 1)
      ),
      body := '{"action":"process_due"}'::jsonb
    );
  $job$
);
```
- Set the Paystack webhook URL to `/functions/v1/paystack-webhook`. The webhook handler verifies the HMAC signature and then verifies transfer status, amount, currency, and reference with Paystack.
- Keep transfers in Paystack test mode until all test cases below pass. Do not use production seller funds for testing.

## Transfer safety

- Every payout gets a stable unique reference before the Paystack request is made.
- The worker never resubmits an ambiguous request. If the request times out after Paystack may have accepted it, the payout is moved to `needs_review`.
- The initiation response never marks a payout paid. Only final provider verification does.
- If Paystack returns an OTP/approval state, the payout remains `awaiting_approval`; the system does not bypass provider approval.
- A `transfer.reversed` event moves the payout to `needs_review`. It is not automatically retried because the original payment may have reached the seller before reversal.
- Existing bank details are not trusted for automatic payout until the seller verifies them again.

## Refund and payout test matrix

Run in a non-production Supabase project with Paystack test credentials and disposable test records.

| Scenario | Expected result |
|---|---|
| Refund before Friday batch generation | Refunded item is excluded from the payout batch |
| Refund after batch creation while payout is still pending | Batch is invalidated, its items are released, and the next batch is recalculated |
| Refund while Paystack transfer is processing or awaiting approval | Adjustment is held provisionally; final transfer success keeps the debit, confirmed failure removes the provisional adjustment and releases the batch |
| Refund after successful payout | Historical payout remains intact; a seller adjustment is created and offset against future earnings |
| Multiple refunds against one paid payout | Each order item creates at most one adjustment |
| Two payout workers claim at once | A payout is claimed once; no duplicate transfer reference is created |
| Paystack transfer pending | Payout remains processing until webhook/verification confirms final state |
| Paystack transfer success | Payout becomes paid once, with provider reference and timestamp |
| Paystack transfer failure | Batch is failed and items become eligible for a later batch |
| Paystack transfer reversal | Payout enters staff review; no automatic resubmission |
| Worker times out after Paystack may have accepted request | Payout enters staff review; no blind retry |
| OTP/approval required | Payout remains awaiting approval; no automatic OTP bypass |
| Incorrect amount/currency/reference in webhook | Event is rejected and payout state is unchanged |

## Deployment order

1. Review and merge this PR.
2. Apply migration `20261124140000_041_paystack_seller_payouts.sql`.
3. Deploy Edge Functions `seller-payouts` and the updated `paystack-webhook`.
4. Configure the secrets and Vault entry above.
5. After configuring both secrets, create and verify the cron job using the SQL above.
6. Run the test matrix in test mode before enabling live seller payouts.

The migration and Edge Function code do not initiate any transfer during deployment. Transfers begin only after the scheduled worker is configured, a verified seller bank recipient exists, and a Super Admin or Finance admin approves the payout in Admin → Dropship sellers.
