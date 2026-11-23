# Phase 5 — Dropshipper profit and withdrawals

## Implementation and validation status (Phase 5 feature branch)

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
5. **Returns and reversals — implementation added on this branch:** migration `20261124100000_034_seller_refund_adjustments.sql` adds an immutable seller refund-adjustment ledger and separate application rows. When a refund touches a pending payout, that unpaid batch is invalidated, its item links are released, and eligible items return to the next Friday batch. When a refund touches a paid payout, a debit adjustment is recorded against the original paid payout; future Friday batches apply as much of the outstanding balance as possible while retaining the ₦1,000 minimum payout threshold. Any remainder carries forward. No automatic bank clawback occurs. The staff payment RPC verifies that payout item earnings minus recorded adjustment applications equal the transfer amount before it can be marked paid. The seller earnings page and staff seller controls expose outstanding adjustment balances. Do not mark a payout as paid when its item eligibility has not been reconciled.
6. **Bank details and authorization:** seller bank details are saved as free-text bank name/account/name. The form's claim that the account name is checked is not backed by the inspected save action; no bank account-name verification API was found. Staff-only manual payout marking requires a transfer reference but does not independently verify the transfer.
7. **Tests and verification:** plan-fee unit coverage has been expanded. The CI run after repairing two escaped-newline parse errors passed lint, typecheck and the test suite; its production build was still running when last checked. A later CI run was triggered after the refund-ledger and staff/seller UI changes and must complete before release. The new SQL migration was executed inside an explicit BEGIN/ROLLBACK against the linked database to validate SQL parsing and dependencies; a follow-up catalog check confirmed the new objects were not persisted. This is a syntax/dependency dry run, not a live migration, behavioural integration test, or concurrency test.

## Scope for this PR

- Preserve the existing Free 5%, Pro 3%, Elite 1.5% fee schedule.
- Preserve automatic Friday 09:00 batch generation; staff manually execute and reconcile bank transfers.
- Do not introduce seller-initiated on-demand withdrawals.
- Do not apply the new payout migration to production until database-level validation is complete.
- Keep the new refund-adjustment migration unapplied until CI and database-level behavioural/concurrency tests pass in an isolated staging database.
- Keep all implementation changes on this feature branch; do not modify `Main` directly.
