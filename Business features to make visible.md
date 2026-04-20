# Business Features To Make Visible Later

This note tracks Business-plan features that are already part of the subscription/feature-gating system, but are not fully visible as dedicated UI screens or sidebar tabs yet. Do not expose these in the sidebar for now.

## Current State

The app already knows these features belong to the Business plan through the billing feature map. Some backend gates and support logic exist, but several features still need proper user-facing screens, cards, settings, or workflows before they should be shown as full product features.

## Features To Surface Later

### 1. Staff Activity Logs

**Current status:** Backend support exists.

The backend can record key actions such as product creation, product updates, product deletion, and sale creation when the Business plan is active.

**Needs visible UI later:**

- Add an `Activity Logs` page or section under `Staff`.
- Show who performed the action, what changed, when it happened, and which object was affected.
- Add filters for action type, staff member, date, and object type.
- Add export support for audit/accountability reports.

### 2. Automation Rules

**Current status:** Backend has rule-based automation alert logic.

The backend can evaluate conditions like low stock or no sales activity.

**Needs visible UI later:**

- Add an `Automation` page or section under `Settings`.
- Allow users to configure rules such as:
  - Low stock alert
  - No sales recorded today
  - Abnormal discrepancy count
  - High expense warning
- Add rule enable/disable toggles.
- Add severity levels and notification channel choices.
- Show recent automation events.

### 3. API Access

**Current status:** Feature exists in the package map, but no full API access screen exists yet.

**Needs visible UI later:**

- Add an `API Access` or `Integrations` page.
- Show API status as locked/unlocked based on plan.
- Add API key generation later.
- Show basic endpoint documentation.
- Add regenerate/revoke API key controls.
- Add request logging or usage limits later.

### 4. Custom Reports

**Current status:** Feature exists in the package map, but no custom report builder exists yet.

**Needs visible UI later:**

- Add a `Custom Reports` section inside `Reports`.
- Allow users to choose metrics, filters, date ranges, and grouping.
- Support saved report templates.
- Add export options for CSV/Excel.
- Keep Starter and Growth users locked out with an upgrade prompt.

### 5. Background Audits

**Current status:** Feature exists in the package map, but no background audit workflow exists yet.

**Needs visible UI later:**

- Add background audit settings under `Audits`.
- Allow scheduled audit checks.
- Show automatically detected discrepancies.
- Show background audit history.
- Add controls for audit frequency and stock categories to monitor.

### 6. Role-Based Access Controls

**Current status:** Staff roles exist, and the feature is mapped to Business.

**Needs visible UI later:**

- Add a permissions matrix under `Staff` or `Settings`.
- Define what Owner, Manager, Cashier, and Stock Manager can view/edit.
- Enforce permissions consistently in backend views.
- Add locked messaging for non-Business plans.

### 7. Multi-Branch Reporting

**Current status:** Multi-branch backend models and Settings UI support exist, gated under Business.

**Needs visible UI later:**

- Add branch filters to Dashboard, Reports, Inventory, Sales, and Staff.
- Show branch-specific stock, revenue, expenses, and staff performance.
- Add branch switching controls in the app header.
- Add branch comparison reports.

### 8. Advanced Forecasting Visibility

**Current status:** Forecasting logic exists in backend endpoints.

**Needs visible UI later:**

- Add a Business-only forecasting panel in Dashboard or Reports.
- Show projected sales for next week/month.
- Show fast-moving products and reorder risks.
- Add charts for forecast vs actual performance.

## Recommended Future Sidebar Changes

Do not add these now, but later the sidebar could include:

- `Automation`
- `API Access`
- `Activity Logs`

Other Business features should probably stay inside existing tabs:

- Custom Reports inside `Reports`
- Background Audits inside `Audits`
- Role Permissions inside `Staff`
- Branch Reporting inside `Reports` and `Dashboard`
- Forecasting inside `Reports` or `Dashboard`

## Important Rule

Before making any of these visible, confirm that each feature has:

- Backend feature gate
- Frontend lock/upgrade prompt
- Real user-facing screen or workflow
- Clear empty state
- Basic error handling
- Plan-aware copy

This keeps the app stable and prevents showing “unfinished” Business features too early.
