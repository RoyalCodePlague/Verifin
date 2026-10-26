# Verifin Retention and Conversion Fixes

This is the merged source of truth for the retention/conversion checklist and the 13-item activation workbook. Duplicate items are combined below; workbook-only ideas are retained as later work rather than silently dropped.

## Primary outcome

Help a new shop get from signup to its first useful stock-to-sale workflow quickly, then make daily activity clear enough to encourage a return. Measure the baseline before setting numerical conversion or retention targets. The workbook's proposed activation measure is the percentage of new shops recording at least five sales within three days; it is a goal to validate, not an established baseline.

## Phase 1 — Activation and reliable first workflow

- Welcome first-time users, show setup progress, save progress between sessions, and let users skip optional setup.
- Guide users through business setup, their first product, first sale, first expense, and business summaries.
- Make the empty dashboard actionable: clearly label missing activity, make the first-product action prominent, and show a progress checklist.
- Make recording a sale quick, validate product quantities and prices, update inventory consistently, prevent duplicate transactions, and provide clear success/error feedback.
- Keep corrections auditable and verify inventory after sales, cancellations, corrections, and concurrent sales.
- Track privacy-conscious milestones: signup completion, business setup, first product, first sale, and first expense. Do not treat demonstration data as business activity.
- Test signup/login, verification/recovery, API communication, account isolation, free-plan limits, inventory consistency, loading/error states, and preservation of existing records.

## Phase 2 — Daily use and retention

- Put frequent actions, today's recorded sales and expenses, current stock, low-stock items, and recent transactions within easy reach.
- Provide useful summaries and help users identify unfinished setup work.
- Offer optional support and reminders; do not send unsolicited or excessive messages.
- Consider a user-controlled WhatsApp/SMS daily summary and low-stock alert after a messaging provider, consent, delivery rules, and costs are confirmed.
- Consider sales-only staff access, visible offline sync status, and mixed-currency sales where existing plan and accounting rules permit.

## Phase 3 — Conversion

- Explain stock, sales, and expenses in plain language; keep a prominent free-start action and easy-to-find interactive demo.
- Clearly explain free-plan capabilities, pricing, record protection, and offline behavior.
- Use authentic application screenshots or clearly labeled sample data; do not present illustrative figures as live account data.
- Test mobile layouts and low-end Android/slow-network performance; remove broken links and unnecessary signup friction.

## Phase 4 — Measurement and iteration

- Establish visitor-to-signup, signup completion, first-product, first-sale, and day-one/day-seven/day-thirty retention baselines.
- Monitor failures in registration, login, and core workflows.
- Review activation weekly, including the workbook's five-sales-within-three-days measure, and prioritize changes based on observed drop-off.
- Anonymous landing-page attribution and repeat-visit measurement need an explicit privacy/consent and event-retention design before collection is enabled.

## Implemented in this change

- Persist and restore per-account onboarding progress; only mark setup complete after requested starter products are created.
- Add a dashboard checklist for the first product, sale, and expense, with direct actions and a progress indicator.
- Add quick-add product buttons to the sale form and direct users with no products to inventory first.
- Remove fabricated sales comparison percentages and show the actual comparison or explain that no baseline exists.
- Use the suggested stock/sales/business headline and clearly label the landing-page preview as illustrative sample data.
- Align first-party account, setup, product, sale, and expense milestones with the activation events named in the merged requirements.

## Deferred pending product decisions or external setup

- WhatsApp/SMS automation and low-stock delivery require provider credentials, user consent, delivery preferences, and operating-cost decisions.
- `landing_page_viewed`, `signup_started`, `dashboard_viewed`, `user_returned`, and day-one/day-seven/day-thirty reporting need repeatable event capture plus a privacy-conscious visitor identity and retention policy.
- Shop-specific starter catalogs, staff sales-only permissions, and additional currency workflows require validation of their business rules and plan limits.
