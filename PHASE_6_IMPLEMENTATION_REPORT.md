# Phase 6 — Advanced Business Features

## Status

The supported Phase 6 workflows are implemented and connected to the application UI.

## Completed

- Extended saved custom reports with multi-field selection (sales, gross profit, and transaction count), server-side execution, day/month/year grouping, date and branch filters, and ascending/descending period sorting. CSV, Excel, and PDF exports include every selected field; old single-metric templates remain compatible.
- Added saved-report CSV, Excel, and PDF exports. Excel export enforces the existing `excel_exports` subscription feature. The report API applies the saved business and branch scope before calculating or exporting data.
- Added API-key request history, response status and latency tracking, and an owner-facing Settings panel. The API returns the latest 100 entries; Settings displays the latest 10. Request bodies, query strings, headers, and secrets are not stored.
- Added an atomic per-key hourly rate limit, configurable through `API_KEY_REQUESTS_PER_HOUR` (default 1,000). Requests made with a valid key are counted and logged even when the key lacks the requested scope.
- Added configurable automation rules with supported triggers for low stock, overdue customer accounts, high expenses, approved purchase orders, and closed tills. Actions create in-app notices or follow-up/reconciliation reminders, or hold an expense for owner approval.
- Large-expense rules are checked before ledger posting. Held expenses remain pending until the owner approves them. Rule and execution history are business-scoped; duplicate events are protected by a unique database constraint, failures can be retried, and the worker recovers stale executions.
- Restricted automation configuration and history to the business owner. API keys cannot administer automation or saved custom-report templates.
- Updated the Settings builder and API documentation, including scheduler requirements.

## Operational requirements and limits

- Expense, purchase-order, and till events are dispatched after the business transaction commits. Low-stock and overdue-account rules require a scheduled backend command: run `python manage.py run_automations` every 5–15 minutes. The existing webhook retry worker also needs its deployment schedule.
- Automation supports the listed event types and safe predefined actions; it does not execute user-supplied code or arbitrary expressions. Notifications are delivered to the business notification center rather than routed to individually selected staff recipients.
- Custom reports currently offer the sales, gross profit, and transaction-count fields. They are not an unrestricted query or arbitrary-column designer.

## Models and migrations

- `accounts.ApiKeyRequestLog`: `accounts` migration `0018_apikeyrequestlog`.
- `reports.AutomationRule` and `reports.AutomationExecution`: `reports` migration `0010_automationrule_automationexecution_and_more`.
- `CustomReport.sort_order` and multi-field selection: `reports` migrations `0011_customreport_sort_order` and `0012_customreport_metrics`.
- Apply Django migrations before deploying the updated application code. No production database was migrated during this work.

## Verification

- Backend regression suite: **225 tests passed** using isolated in-memory SQLite test settings.
- Django system check passed; `makemigrations --check --dry-run` reported no changes.
- Frontend: **33 tests passed**, TypeScript check passed, and the production Vite build/prerender completed.
