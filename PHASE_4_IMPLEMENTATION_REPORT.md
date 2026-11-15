# Verifin Phase 4 — Multi-Branch Management

**Status: complete for current branch and transfer workflows.**

## Features completed

- Branch administration supports branch names, codes, addresses, contacts, opening dates, primary location, and managers assigned from active staff at that branch. Branch deletion is blocked while records remain linked.
- Branch assignments are integrated across staff, products, sales, tills, expenses, customers, suppliers, purchase orders, and reporting.
- The Reports page now uses the branch overview API for consolidated and selected-branch figures. Owners can select the whole business (including unassigned transactions) or one or more branches, choose a reporting period, and view profit, expenses, inventory valuation, current customer/supplier balances, and stock in transit.
- Per-branch current and prior-period comparisons normalize by operating days and opening date. Branch rows include net sales, gross profit, net profit, expenses, inventory cost, current receivables/payables, and outgoing stock in transit.
- Stock transfers support request, approval/rejection, cancellation before dispatch, dispatch, partial receipt, discrepancies, event history, stock movements, and batch-aware inventory handling. Discrepant quantities are recorded without creating destination stock.
- Staff branch restrictions are enforced in backend report selection, queryset scoping, and transfer actions. Tests verify that staff cannot retrieve another branch's product or report data, dispatch stock for an unauthorized source branch, or make an owner select a branch from another business.
- Branch supplier balances now reuse the shared received-cost calculation, including pre-GRN quantities and confirmed GRNs together.

## Files and data changes

- `backend/reports/branch_views.py` — branch overview supplier balances now use shared, batched receipt calculations.
- `backend/inventory/supplier_financial_services.py` — batched per-order receipt totals shared by supplier, insight, and branch reporting.
- `backend/reports/insight_services.py` — uses the batched shared receipt calculation.
- `backend/reports/test_branch_overview.py` — consolidated totals, opening-date normalization, mixed receipts, foreign-branch rejection, staff scoping, and inventory valuation workflows.
- `backend/inventory/tests.py` — partial receipt/discrepancy workflow and unauthorized dispatch test.
- `src/pages/Reports.tsx` — live branch comparison and consolidated reporting controls, loading/error/empty states, and period-aware figures.
- `README.md` — multi-branch behavior and current reporting boundaries.
- No new database models or migrations were needed for this phase.

## APIs

- Existing `GET /api/v1/reports/branch-overview/` is now connected to the Reports page for all-business or selected-branch views.
- Existing branch CRUD endpoints remain under `/api/v1/inventory/branches/`.
- Existing transfer actions remain under `/api/v1/inventory/transfers/{id}/` for approval, rejection, cancellation, dispatch, and receipt; product transfer requests use `/api/v1/inventory/products/{id}/transfer/`.

## Verification

- Backend regression suite: **194 tests passed**.
- Frontend Vitest: **33 tests passed**; TypeScript check and production build/prerender passed.
- Django migration check: **no model/migration drift**.
- `git diff --check` passed with only Git line-ending normalization notices.

## Remaining constraints

- Whole-business totals include unassigned records; selected-branch totals intentionally exclude them and identify that scope in the response.
- Customer and supplier debt figures are current balances, not historical balances as of the selected reporting period.
- Staff see their assigned branch only; consolidated business totals remain owner-level reporting.
