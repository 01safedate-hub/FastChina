# Phase 5 — Dropshipper profit and withdrawals

## Current implementation audit (Main)

### Plan fees — source of truth
`src/lib/dropship/plans.ts` defines plan-specific fees deducted from seller markup:
- Free: 5%
- Pro: 3%
- Elite: 1.5%

The same values are encoded in `public.plan_rules(text)` in migration `20261118100000_015_dropship_stores.sql`. The `store_earnings_all` view calculates the fee from the store's current plan and calculates net seller earnings as gross markup less that fee.

**Policy constraint:** do not replace these fees with a flat 20% commission unless the product owner explicitly changes the pricing policy and both application and database rules are updated together. The 20% proposal conflicts with the existing plan-specific schedule.

### Existing earnings and payout foundation
- `store_earnings_all` calculates gross markup, plan fee, net earnings, and earning buckets.
- `store_earnings` filters earnings to the store owner or staff.
- Earnings become `available` when the order is delivered; cancelled/refunded orders and removed items are void.
- The Friday cron runs at 09:00 and creates payout batches for eligible available earnings when the store has bank details and the batch is at least ₦1,000.
- Payout creation snapshots bank details, links items to a payout, and stores a pending payout record.
- `seller_payouts` has pending/paid/failed states and a reference field.
- The product decision for this phase is scheduled weekly Friday payouts. Do not add an on-demand seller withdrawal request flow.

### Findings and remaining work
1. **Payout execution is manual:** the Friday cron job creates pending payout batches. There is no bank-transfer API call in the inspected seller/admin payout flow. Staff can mark a pending payout as paid by entering a transfer reference. No provider-side transfer reconciliation was found.
2. **Concurrency/idempotency hardening added in this PR:** migration `20261123153000_033_safe_weekly_seller_payout_batches.sql` serializes payout generation per store, locks eligible order items, and only batches items whose `payout_id` is still null. It rolls back if the expected item assignment count changes. The critical locking query was checked with PostgreSQL `EXPLAIN` against the live schema; PostgreSQL produced a `LockRows` plan for `FOR UPDATE OF i SKIP LOCKED`. This is query-plan validation, not a full migration execution or concurrency test. The migration is committed to the PR branch but has not been applied to the live database.
3. **No separate seller withdrawal request flow was found:** the current product model is scheduled weekly payouts, not a withdraw-anytime wallet. The customer wallet ledger is separate and should not be reused for seller earnings without an explicit ledger design.
4. **Plan-fee consistency:** unit tests assert the Free 5%, Pro 3%, and Elite 1.5% rates and the naira rounding behaviour. SQL `plan_rules()` must remain aligned with `PLANS` and the earnings view.
5. **Returns and reversals — release blocker:** `cancel_or_refund()` changes the order status and credits the customer/refund-due ledger, while the earnings view marks cancelled/refunded items void. It does not reconcile a payout that already references those items. A pending payout could therefore retain an amount that includes void earnings; a paid payout needs an auditable seller-balance adjustment rather than an automatic clawback. This needs a dedicated, transactional ledger and staff reconciliation workflow before Phase 5 can be called complete. Do not mark a payout as paid when its item eligibility has not been reconciled.
6. **Bank details and authorization:** seller bank details are saved as free-text bank name/account/name. The form's claim that the account name is checked is not backed by the inspected save action; no bank account-name verification API was found. Staff-only manual payout marking requires a transfer reference but does not independently verify the transfer.
7. **Tests and verification:** plan-fee unit coverage has been expanded. The repository's full lint/typecheck/test/build pipeline has not been run in this environment. The SQL payout migration still needs full database-level validation, including idempotency/concurrency and failure-path tests.

## Scope for this PR

- Preserve the existing Free 5%, Pro 3%, Elite 1.5% fee schedule.
- Preserve automatic Friday 09:00 batch generation; staff manually execute and reconcile bank transfers.
- Do not introduce seller-initiated on-demand withdrawals.
- Do not apply the new payout migration to production until database-level validation is complete.
- Complete refund/reversal accounting before enabling payment of potentially affected batches.
- Keep all implementation changes on this feature branch; do not modify `Main` directly.
