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
- `create_weekly_payouts()` creates Friday payout batches for eligible available earnings when the store has bank details and the batch is at least ₦1,000.
- Payout creation snapshots bank details, links items to a payout, and stores a pending payout record.
- `seller_payouts` has pending/paid/failed states and a reference field.

### Findings and remaining work
1. **Payout execution is manual:** the Friday cron job creates pending payout batches. There is no bank-transfer API call in the inspected seller/admin payout flow. Staff can mark a pending payout as paid by entering a transfer reference. No provider-side transfer reconciliation was found.
2. **Concurrency/idempotency hardening added in this PR:** migration `20261123153000_033_safe_weekly_seller_payout_batches.sql` serializes payout generation per store, locks eligible order items, and only batches items whose `payout_id` is still null. It rolls back if the expected item assignment count changes. This migration is committed to the PR branch but has not been applied to the live database.
3. **No separate seller withdrawal request flow was found:** the current product model is scheduled weekly payouts, not a withdraw-anytime wallet. The customer wallet ledger is separate and should not be reused for seller earnings without an explicit ledger design.
4. **Plan-fee consistency:** application tests already assert seller net for Free 5%, Pro 3%, and Elite 1.5%. Keep SQL `plan_rules()` aligned with `PLANS` and the earnings view.
5. **Returns and reversals:** confirm and implement a safe adjustment path for refunds/cancellations after an item has been assigned to a pending or paid payout. Never silently claw back a completed bank transfer.
6. **Bank details and authorization:** seller bank details are saved as free-text bank name/account/name. The form's claim that the account name is checked is not backed by the inspected save action; no bank account-name verification API was found. Staff-only manual payout marking requires a transfer reference but does not independently verify the transfer.
7. **Tests:** add coverage for plan fees, payout eligibility, minimum threshold, duplicate runs, reversals and failure/retry handling. The current repository has unit tests for the plan fee calculations; the new SQL migration still needs database-level validation.

## Scope for this PR

- Preserve the existing Free 5%, Pro 3%, Elite 1.5% fee schedule unless an explicit pricing-policy decision changes it.
- Complete the implementation audit before changing money movement or ledger behaviour.
- Implement and test a consistent seller earnings/withdrawal lifecycle, including safe payout execution and reconciliation where supported.
- Do not mark payouts as paid until the transfer provider confirms success.
- Keep all implementation changes on this feature branch; do not modify `Main` directly.
