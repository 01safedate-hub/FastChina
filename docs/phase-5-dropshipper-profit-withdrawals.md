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

### Important gaps to verify and address
1. **Payout execution:** the current weekly function creates payout records; it does not itself demonstrate a bank-transfer API call or provider reconciliation.
2. **Duplicate safety:** audit locking/idempotency around concurrent weekly payout generation and item assignment. Ensure an earning cannot be included in more than one payout.
3. **Withdrawals:** inspect the seller earnings UI and existing wallet/withdrawal schema before deciding whether sellers withdraw from a balance or receive scheduled payouts. Avoid introducing a second balance ledger without reconciling existing structures.
4. **Plan-fee consistency:** ensure UI calculations, server actions, SQL views/functions and tests all use the same plan-specific rates.
5. **Returns and reversals:** verify what happens when an order is returned/refunded after earnings have become available or have been included in a payout.
6. **Bank details and authorization:** verify account ownership, validation, staff permissions, payout status transitions and audit history.
7. **Tests:** add coverage for all plan fees, payout eligibility, minimum threshold, duplicate runs, reversals and failure/retry handling.

## Scope for this PR

- Preserve the existing Free 5%, Pro 3%, Elite 1.5% fee schedule unless an explicit pricing-policy decision changes it.
- Complete the implementation audit before changing money movement or ledger behaviour.
- Implement and test a consistent seller earnings/withdrawal lifecycle, including safe payout execution and reconciliation where supported.
- Do not mark payouts as paid until the transfer provider confirms success.
- Keep all implementation changes on this feature branch; do not modify `Main` directly.
