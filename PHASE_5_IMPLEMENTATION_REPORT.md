# Phase 5 — Team Management and Accountability

## Status

**Complete for the supported staff, approval, audit, and till workflows.**

## Completed

- Added role presets for Administrator, Branch Manager, Salesperson, Inventory Manager, Accountant and Custom, alongside the existing roles. Staff access can be edited after creation.
- Added named action permissions for voids, large discounts, refunds, stock changes, supplier payments, purchase order approval, till review and financial adjustments. Backend checks enforce them independently of frontend visibility.
- Added configurable approval thresholds for discounts, refunds, stock adjustments, supplier payments and purchase orders. Defaults are 20%, 100 base-currency units, 10 units, 500 base-currency units and 500 base-currency units. Setting a threshold to null disables that additional threshold. High-value API-key operations are denied.
- Added staff identity and an actor-name snapshot to activity logs. Logged events now include before/after values for staff access, products, branches, sales, refunds, expenses, supplier records and payments, purchase orders, GRNs, supplier returns, stock transfers, customer credit activity, financial account changes and reconciliations. User-agent data is captured when available.
- Made activity logs read-only through the API and Django admin. Added searchable filters and metadata details to the Staff page.
- Added owner-managed approval settings with audit logging. Added stock-movement records for opening stock through product creation, bulk import and the legacy add-item route.
- Added a separate-approver check for large operations through the configured action permissions. Till review retains its existing self-review protection; purchase orders retain their submit/approve lifecycle.
- Added a pending approval inbox for protected discounts, refunds, stock adjustments, supplier payments, sale voids, purchase-order approvals, till reviews, and financial adjustments. Requests preserve the exact method, path, query, and payload; credential-like fields and oversized payloads are rejected.
- Added maker-checker review: the requester cannot approve their own request, staff reviewers need the action permission and the same branch, owners can review business-wide, and approvals expire after 30 minutes and can be consumed once by an exact retry. Requests and decisions are logged and notify the business.
- Pending requests are saved after protected operations roll back, so transactional failures still leave a reviewable request.

## Remaining limits

- Activity logs capture the request user agent as a source hint; there is no persistent device/session identifier.
- Custom permissions are managed on staff accounts; there is no separate reusable role-template library.

## Files changed

- Backend: `accounts/models.py`, `activity.py`, `approvals.py`, `authentication.py`, `branch_access.py`, `exceptions.py`, `admin.py`, `serializers.py`, `views.py`, `urls.py`; `customers/views.py`; `expenses/views.py`; `inventory/serializers.py`, `views.py`, `purchasing_serializers.py`, `purchasing_views.py`; `reports/account_views.py`; `sales/serializers.py`, `views.py`.
- Frontend: `src/pages/Staff.tsx`, `src/pages/Approvals.tsx`, `src/pages/ApiDocs.tsx`, `src/App.tsx`, `src/components/layout/AppLayout.tsx`, `src/lib/api.ts`, `src/lib/auth-context.tsx`, `src/lib/store.tsx`.
- Regression coverage: `backend/accounts/test_activity.py` and `backend/accounts/test_approval_requests.py`.

## Models and migrations

- `StaffActivityLog` now stores `staff_actor` and `actor_name`.
- Added `ApprovalSettings`; expanded allowed staff role choices.
- Added `ApprovalRequest` with branch scope, exact-payload hash, expiry, decision, and single-consumption state.
- New accounts migrations: `0014_staffactivitylog_actor_name_and_more`, `0015_alter_staff_role`, `0016_approvalsettings`, `0017_alter_approvalsettings_discount_percent_threshold`, `0018_apikeyrequestlog`, `0019_approvalrequest`.
- Run normal Django migrations before deploying. These changes add nullable audit fields and a settings table; no production database was migrated during this work.

## API and frontend

- Added `GET/PATCH /api/v1/accounts/approval-settings/` for business-owner threshold configuration.
- Added `GET /api/v1/accounts/approval-requests/` and `POST /api/v1/accounts/approval-requests/{id}/approve|reject/` for scoped review. API keys cannot access the inbox.
- Extended the existing Staff and activity-log APIs; added fields to activity-log responses.
- The Staff page edits roles and permissions, shows threshold settings to the owner, searches logs and displays metadata. The Approvals page lists pending/recent requests and exposes authorized review actions.

## Verification

- Backend regression suite: **225 tests passed** using the isolated in-memory SQLite test settings.
- Django system check: passed; `makemigrations --check --dry-run`: no changes detected.
- Frontend tests: **33 passed**; TypeScript check passed.

## Security notes

- Branch restrictions remain backend-enforced. Financial adjustment and high-value approval checks run server-side.
- Activity records cannot be changed through the API or Django admin. The user-agent value is truncated to 500 characters.
- API keys cannot access the approval inbox or perform configured high-value/financial approval operations; existing sales-scoped key behavior remains governed by its sales scope. Apply the new migrations before enabling the updated application code.
