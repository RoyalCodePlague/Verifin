# Verifin — Smart Inventory & Admin for African SMEs

Automate your admin, control your stock, and stop losing money. The all-in-one business OS for African SMEs.

## Scheduled audits

The audit scheduler creates an in-progress audit when an account's daily or weekly schedule becomes due. Run this command from the backend at least hourly using the deployment platform's cron facility:

```sh
python manage.py run_scheduled_audits
```

Each run is idempotent for a schedule interval. Scheduled audits require the Business plan; a due schedule is advanced without creating an audit if its account no longer has access.

## Webhook delivery

Webhook deliveries are queued when subscribed events occur. Run this command from the backend using the deployment platform's cron facility, preferably hourly:

```sh
python manage.py deliver_webhooks
```

Webhook destinations must be public HTTPS endpoints on port 443. Requests include an HMAC-SHA256 signature; see the API documentation for the signing headers and retry behavior.

## Financial management

The Reports page includes a period-based Profit & Loss report (today, this week, this month, previous month, this quarter, this year, or an inclusive custom date range) with comparison to the prior matching period. It reports gross sales, discounts, returns/refunds, net sales, cost of goods sold, gross profit, operating expenses, other income/expenses, net profit, recorded cash received, and supplier payments separately.

Sale-line costs and discounts are saved with each transaction so later product price changes do not rewrite historical results. Recording a return refunds at the original discounted sale price, reverses the saved cost for the returned quantity, and restores stock. Record incidental income from the Profit & Loss section; classify expenses as operating or other in Expenses.

Inventory purchases and supplier payments are shown as cash activity, not deducted from profit when purchased. Cost of goods sold is recognized from the saved cost of items sold. Existing sales predate explicit discount and return records, so historical discounts default to zero and only newly recorded returns affect the report.

The **Financial accounts** page supports cash, bank, EcoCash, InnBucks, other mobile-money, and custom accounts. It records opening balances, receipts, payments, transfers, and reconciliation changes; posted ledger entries cannot be edited or deleted. Account balances use saved transaction-time exchange rates, and historical closing balances are available by date. Cross-currency transfers require an explicit destination-per-source rate.

## VERIFIN INSIGHTS

The **VERIFIN INSIGHTS** page generates deterministic observations from recorded transactions and inventory, including sales trends and product performance, expense category changes and recurring patterns, stock risks, historical purchase-cost changes, profit trends, customer/supplier balances, and payment-account activity. Each observation keeps its evidence, reporting period, priority, recommended action, and a link to related records. Users can acknowledge or dismiss active items; generated, acknowledged, dismissed, and resolved items remain in insight history.

Comparisons use matching month-to-date windows or two complete rolling periods. Current-day figures are labeled partial and are not compared with complete days. Product sales declines compare net units across two complete 30-day periods and include recorded returns. Profit figures reuse the Profit & Loss calculation, including saved sale costs and recorded returns; net sales are distinguished from cash received. Payment-account observations include only transactions entered in the account ledger, not sales or expenses that have not been posted there. Budget-overrun observations use approved expenses. Branch expense and net-profit comparisons are shown only when relevant transactions are assigned to branches, and they account for each branch's active days from its opening date. Rules are suppressed when the required records or comparison baseline are unavailable.

## Purchasing and inventory intelligence

Purchase orders are saved as drafts and do not change stock. Submit and approve an order before recording deliveries. Each goods-received note (GRN) supports partial quantities, damaged/missing units, actual unit costs, batch/expiry details, and delivery documents. Confirming a GRN adds only accepted units to stock and creates linked stock movements and immutable purchase-cost history. Confirmed receipts can be returned to the supplier. Returns of accepted goods reduce stock and the supplier balance; damaged goods rejected at receipt are recorded without reducing stock a second time. Retrying a return with the same idempotency key does not repeat the adjustment.

Existing sent and received purchase orders are migrated to approved and fully received states. Their recorded quantities and costs are retained as legacy GRNs and purchase-cost history without replaying stock movements.

The **Inventory intelligence** page reports recorded sales velocity, returns-adjusted product performance, batch ageing, inventory valuation, weighted historical purchase costs, stock turnover where movement records allow opening stock to be reconstructed, dead stock with known batch age, and reorder alerts. Untracked stock is valued at the current saved product cost; tracked batches use their saved batch costs. Reorder recommendations are informational and never create orders or change product prices automatically.

## Multi-branch operations

Manage branch names, contacts, opening dates, primary location, and branch managers in Settings. Assign staff, products, sales, tills, expenses, customers, and purchase orders to locations. The Reports page uses the branch overview API to compare selected branches or the whole business, including unassigned transactions in whole-business totals. It reports profit and loss, inventory value, current customer and supplier balances, and stock in transit; per-day comparisons account for each branch's opening date. Stock transfers use request, approval, dispatch, partial receipt, discrepancy, and event-history records. Staff branch restrictions are applied by backend query and action checks.

## Opt-in analytics retention

Activation events are collected only after an account opts in under **Settings → Privacy & Product Analytics**. Events use a random pseudonymous account reference, contain no business records, and are deleted when consent is withdrawn or the account is removed. Run this command daily using the deployment platform's cron facility to enforce the 12-month retention limit:

```sh
python manage.py purge_product_events
```

## Email notifications

Opted-in daily business summaries and automation alerts are sent only to the business account's email address. In **Settings**, enable email delivery consent, then select Email for automation alerts and/or enable the daily summary. Configure `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION`, and `DEFAULT_FROM_EMAIL` before running this command daily:

```sh
python manage.py send_daily_emails
```

## Paynow subscriptions

Paynow hosted and mobile checkout are available when the merchant account is approved and these backend environment variables are configured:

- `PAYNOW_ENABLED=true`
- `PAYNOW_ENV=production`
- `PAYNOW_INTEGRATION_ID`
- `PAYNOW_INTEGRATION_KEY`
- `FRONTEND_URL`

Keep merchant credentials in the deployment secret manager. `PAYNOW_API_BASE` defaults to the staging endpoint outside production and the production endpoint when `PAYNOW_ENV=production`. Sandbox/mobile tests also require `PAYNOW_TEST_EMAIL`. The current checkout supports paid plans priced in USD (including Zimbabwe pricing); other regional currencies are not accepted by Paynow.
