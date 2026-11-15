# Verifin Phase 3 — Verifin Insights

**Status: complete for the supported recorded-data workflows.**

## Features completed

- The Insights module generates stored, rules-based findings with evidence, reporting periods, priority, recommended actions, and related-page links. Users can acknowledge or dismiss findings and review insight history.
- Sales observations cover month-to-date and complete-week trends, current-day performance, best-selling, highest-revenue and highest-gross-profit products, product sales declines, average transaction value, peak weekday, cashier and staff performance, and branch sales.
- Product declines compare net units across two complete 30-day windows and count returns in the period recorded. Findings require at least a two-unit and 25% decline.
- Expense findings cover budget overruns, the largest category, material category increases, expenses growing faster than sales, repeated monthly expense patterns, and branch expense differences normalized by active days.
- Inventory findings cover low stock, runout risk, excess stock, non-moving and slow-moving products, recorded purchase-cost changes, and low-margin products.
- Financial findings cover gross and net profit trends, expense share of sales, customer and supplier debt, account-ledger cash activity, branch gross profit, and branch net profitability.
- Supplier-debt insight calculations include both legacy received quantities and GRN-confirmed receipts through the shared supplier financial calculation.
- Sale business dates now use Django's configured local date. This keeps sales, ledger postings, and daily reports aligned when the operating system date and configured business timezone differ near midnight.

## Files and data changes

- `backend/reports/insight_services.py` — insight rules, shared financial summaries, and branch-aware comparisons.
- `backend/reports/test_insights.py` — workflow coverage for declines, branch comparisons, employee attribution, and legacy supplier debt.
- `backend/sales/models.py` and `backend/sales/migrations/0012_alter_sale_date.py` — timezone-consistent default for new sale dates; existing sale dates are preserved.
- `README.md` — updated Insights behavior and data requirements.

## Verification

- Backend regression suite: **189 tests passed**.
- Focused tests passed for branch expense/profit comparisons, legacy supplier debt, and product declines.
- Django migration check: **no model/migration drift**.
- `git diff --check` passed; Git reported only line-ending normalization notices.
- Frontend Insights already supports active findings, history, evidence, related links, and acknowledge/dismiss actions. The existing frontend suite (33 tests), TypeScript check, and production build/prerender passed during Phase 1; no Insights UI changes were needed for this phase.

## Data and attribution limits

- Staff sales attribution uses the staff member linked to the till session that recorded the sale. It cannot split a shared till's sales among multiple staff members.
- Branch comparisons are suppressed when relevant transactions are unassigned, so the page does not present incomplete branch totals as consolidated truth.
- Account cash-flow observations use posted account-ledger transactions; sales or expenses without account allocations are not counted as ledger activity.
- Sales history predating recorded line costs, discounts, returns, or staff/branch associations cannot be reconstructed retroactively.
