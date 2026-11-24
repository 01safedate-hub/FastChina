# Phase 6 — Seller subscription management

Branch: `feat/phase-6-subscription-management`

## Included

- Reworks the seller Plan screen into **Manage subscription**.
- Shows the current plan, plan expiry date, store status, and the existing Free-plan lifetime sales allowance.
- Keeps the existing Pro and Elite upgrade checkout choices for Paystack and Flutterwave.
- Adds seller billing history for subscription payment attempts.
- Adds `my_subscription_payment_history()`, a security-definer RPC scoped to `auth.uid()`; the payment ledger remains inaccessible for direct browser reads.
- Renames the seller navigation item to **Manage subscription**.

## Existing payment behaviour discovered

The existing `create-payment` Edge Function supports both Paystack and Flutterwave for seller subscription checkout. It creates a one-time payment transaction and only activates the plan after verified payment via `record_verified_payment()`.

This is **not automatic recurring billing**. The existing `set_store_plan()` advances `plan_renews_at` by the paid month, while `expire_store_plans()` downgrades expired plans after its grace period. Neither existing gateway flow creates a provider-managed recurring subscription.

The Manage Subscription page therefore explicitly tells sellers that renewal is currently manual. It does not claim that automatic charges, cancellation-at-period-end, payment-method management, or automatic renewal retries are active.

## Provider recurring-billing research

- Paystack supports recurring subscriptions using Paystack plans and an eligible reusable authorization. See https://paystack.com/docs/api/subscription/ and https://paystack.com/docs/payments/subscriptions/.
- Flutterwave supports recurring billing using Payment Plans (provider-managed renewals) or tokenization (merchant-managed renewals). Payment Plans are the simpler fit for this product. See https://developer.flutterwave.com/docs/recurring-payments/payment-plans and https://developer.flutterwave.com/api/payment-plans/create-payment-plan-1.

## Required before enabling automatic renewal

1. Create and configure Paystack monthly Pro and Elite plan codes.
2. Create and configure Flutterwave monthly Pro and Elite payment-plan IDs.
3. Add server-side configuration for those provider plan IDs; never expose secret keys to the browser.
4. Extend the payment ledger to persist provider subscription IDs, status, next billing time, and cancellation state.
5. Verify and idempotently process each provider's subscription lifecycle webhooks, including successful renewals, failed charges, cancellations, and reactivation.
6. Ensure each successful renewal extends the store plan exactly once, and failed renewals follow a documented grace-period policy.
7. Add seller cancellation/reactivation controls that call the provider APIs and update local state only after provider confirmation.
8. Test both providers in their test environments before enabling live recurring billing.

## Migration

`supabase/migrations/20261125100000_035_seller_subscription_history.sql` adds the authenticated, owner-scoped billing-history RPC. It is included in this branch and has **not** been applied to the live Supabase project.

## Existing business rules preserved

- Free: 20 active products, ₦2,000,000 lifetime sales limit, 5% fee on seller markup.
- Pro: ₦15,000/month, 200 active products, 3% fee on seller markup.
- Elite: ₦45,000/month, 100,000 product cap (application presents as unlimited), 1.5% fee on seller markup.
- No 20% FastChina commission was introduced.
