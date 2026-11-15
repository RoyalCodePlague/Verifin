# Verifin Phase 2 — Purchasing and Advanced Inventory

**Status: complete for the current purchasing and inventory workflows.**

## Features completed

- Supplier profiles retain contact and payment terms, notes, preferred products, purchase history, invoices, payment history, and performance indicators.
- Purchase orders follow draft, submitted, approved, partially received, fully received, completed, and cancelled states. Creating or approving an order does not increase available stock.
- Goods Received Notes support partial deliveries, actual costs, missing and damaged quantities, batch/expiry data, delivery documents, confirmation, stock movement history, and supplier balance updates.
- Supplier returns cover damaged, incorrect, expired, excess, and other rejected goods, with quantity controls, stock movements, financial credits, and idempotency protection.
- Purchase cost history preserves supplier-specific costs. Inventory intelligence reports recorded movement, velocity, costs, valuation, ageing, margins, and reorder recommendations without making purchases or changing prices automatically.
- Branch transfers use approval, dispatch, in-transit quantities, partial receipt, discrepancy records, and event history.

## Files and data changes

- Purchasing and GRN APIs are implemented in the inventory app, with supplier and inventory workspaces in the frontend.
- Models cover purchase orders and events, GRNs and attachments, supplier returns and payments, purchase-cost history, and stock-transfer events.
- Relevant additive inventory migrations are present through `inventory.0014_supplierpayment_financial_account`; apply pending migrations with `python manage.py migrate`.

## Verification

- The backend regression suite passed **184 tests**, including purchase order, partial GRN, supplier return, supplier payment, stock movement, cost history, and inventory intelligence workflows.
- Frontend Vitest passed **33 tests**; TypeScript and production build/prerender passed.
- Migration drift check and `git diff --check` passed.

## Security and remaining scope

- Supplier, purchase, receipt, return, payment, stock, and transfer queries enforce business ownership. Branch-scoped users are restricted on backend reads and writes.
- No material Phase 2 workflow gap was found in this pass. Later phases still need work; in particular, Phase 3 branch-level expense and profitability insights need to reuse branch-tagged transactions consistently.
