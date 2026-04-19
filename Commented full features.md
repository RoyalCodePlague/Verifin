# Commented Full Features

## Multiple Branch Feature

This document comments the current multiple branch feature across the frontend, backend, API layer, and related tabs. The feature lets one user/business manage several shop locations, assign products and transactions to those locations, and keep branch-aware inventory and sales records.

## Main Branch Setup

Location: `src/pages/Settings.tsx`

The Settings tab is the main place where branches are created and managed.

### Branch Inputs

The branch form contains these inputs:

- `Branch Name`
  - Required by the UI.
  - Example: `Main Shop`, `CBD Branch`, `Warehouse`.
  - Sent to backend as `name`.

- `Code`
  - Optional short identifier.
  - Example: `MAIN`, `CBD`, `WH1`.
  - Sent to backend as `code`.

- `Phone`
  - Optional branch contact number.
  - Sent to backend as `phone`.

- `Address`
  - Optional physical branch address.
  - Sent to backend as `address`.

### Add Branch Behavior

When the user clicks `Add Branch`, the frontend calls:

```ts
createBranchApi({
  name,
  code,
  phone,
  address,
  is_primary,
})
```

Backend endpoint:

```text
POST /api/v1/inventory/branches/
```

Backend model:

```text
inventory.Branch
```

Backend fields:

- `user`
- `name`
- `code`
- `phone`
- `address`
- `is_primary`

### Primary Branch Behavior

If the user creates their first branch, the frontend marks it as primary.

The backend also protects primary branch behavior:

```python
if self.is_primary:
    Branch.objects.filter(user=self.user, is_primary=True).exclude(pk=self.pk).update(is_primary=False)
```

This means only one branch per user should be primary at a time.

### Make Primary Button

The Settings tab shows `Make Primary` for non-primary branches.

Frontend action:

```ts
updateBranchApi(id, { is_primary: true })
```

Backend endpoint:

```text
PATCH /api/v1/inventory/branches/:id/
```

### Delete Branch Button

The Settings tab shows `Delete` for every branch.

Frontend action:

```ts
deleteBranchApi(id)
```

Backend endpoint:

```text
DELETE /api/v1/inventory/branches/:id/
```

Current note: branch deletion removes the branch from the local store immediately. Backend behavior depends on the API delete flow and soft-delete model behavior.

## Inventory Tab Integration

Location: `src/pages/Inventory.tsx`

The Inventory tab uses branches when adding or editing products.

### Product Branch Input

In the Add/Edit Product dialog, there is a `Branch` select input:

```tsx
<select value={form.branchId}>
  <option value="">No branch assigned</option>
  {branches.map(b => <option value={b.id}>{b.name}</option>)}
</select>
```

This input lets the user assign a product to a branch.

### Default Branch Selection

When adding a product, the form defaults to:

```ts
branches.find(b => b.isPrimary)?.id || branches[0]?.id || ""
```

Comment: if a primary branch exists, new products default to it. If no primary branch exists but branches exist, the first branch is used. If no branches exist, the product can be created without a branch.

### Product Save Payload

When creating or updating a product, the frontend sends:

```ts
branch: form.branchId || undefined
```

Backend endpoint:

```text
POST /api/v1/inventory/products/
PATCH /api/v1/inventory/products/:id/
```

Backend model field:

```text
Product.branch
```

### Branch Display In Product Table

The Inventory table has a `Branch` column.

Display behavior:

```ts
p.branchName || "Main"
```

Comment: products without a branch are shown as `Main` in the table, even though the backend value may be `null`.

### Backend Product Validation

The backend validates that a selected branch belongs to the current user:

```python
if branch and branch.user_id != user.id:
    raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
```

This prevents a user from assigning products to another user's branch.

### Branch Filtering API

Products can be filtered by branch:

```text
GET /api/v1/inventory/products/?branch=:branch_id
```

Backend code:

```python
branch = self.request.query_params.get("branch")
if branch:
    qs = qs.filter(branch_id=branch)
```

Current note: the frontend Inventory page displays branch names, but it does not currently expose a branch filter dropdown.

## Sales Tab Integration

Location: `src/pages/Sales.tsx`

The Sales tab uses branches mainly through till sessions.

### Open Till Branch Input

When opening a till, there is a `Branch` select input:

```tsx
<select value={tillForm.branch}>
  <option value="">No branch</option>
  {branches.map(b => <option value={b.id}>{b.name}</option>)}
</select>
```

This lets the user link a till shift to a branch.

### Open Till Payload

Frontend payload:

```ts
openTillApi({
  branch: tillForm.branch ? Number(tillForm.branch) : null,
  cashier_name: tillForm.cashier,
  opening_cash: tillForm.openingCash || "0",
})
```

Backend endpoint:

```text
POST /api/v1/sales/tills/
```

Backend model:

```text
sales.TillSession.branch
```

### Sale Branch Assignment

When recording a sale, the frontend sends the open till's branch:

```ts
branch: till?.branch || null
```

Backend endpoint:

```text
POST /api/v1/sales/
```

Backend model:

```text
sales.Sale.branch
```

Comment: sales do not have a separate branch dropdown in the sale modal. Instead, the branch comes from the currently open till session.

### Branch Safety During Sales

The backend validates product and branch compatibility:

```python
if branch and product and product.branch_id and product.branch_id != branch.id:
    raise serializers.ValidationError({"sale_items": f"{product.name} belongs to another branch."})
```

Comment: if a product is assigned to Branch A, the backend blocks it from being sold through a sale linked to Branch B.

### Receipt Branch Display

Receipts include branch name:

```python
"branch": sale.branch.name if sale.branch else ""
```

Frontend receipt output:

```ts
receipt.branch ? `Branch: ${receipt.branch}` : ""
```

Comment: receipts show the branch only when the sale has a branch.

### Till Closing

Till closing does not choose a branch again. It closes the currently open till and calculates:

- cash sales
- expected cash
- actual closing cash
- variance
- card total
- EFT total

Because the till is branch-linked, those totals are branch-linked through the till session.

## Suppliers And Purchase Orders Integration

Location: `src/pages/Suppliers.tsx`

The Suppliers tab uses branches in purchase orders and low-stock suggestions.

### Purchase Order Branch Input

The Create Purchase Order dialog has a `Branch` select:

```tsx
<select value={orderForm.branch}>
  <option value="">No branch</option>
  {branches.map(b => <option value={b.id}>{b.name}</option>)}
</select>
```

Frontend payload:

```ts
branch: orderForm.branch ? Number(orderForm.branch) : null
```

Backend endpoint:

```text
POST /api/v1/inventory/purchase-orders/
```

Backend model:

```text
inventory.PurchaseOrder.branch
```

### Reorder Suggestions Branch Awareness

Low-stock suggestions display each product's branch:

```ts
item.product.branch_name || "Main"
```

When the user creates a purchase order from a suggestion, the branch is prefilled from the suggested product:

```ts
branch: item.product.branch ? String(item.product.branch) : ""
```

Comment: this connects low-stock products to branch-specific purchasing.

### Receiving Purchase Orders

Receiving a purchase order increases stock on the linked product:

```python
product.stock += qty
product.cost_price = item.unit_cost
product.save()
```

Comment: because the product itself is branch-linked, receiving stock updates that product's branch inventory.

Current note: the receive flow updates product stock, but does not currently create or move product stock based on the purchase order branch if the selected product belongs to another branch. The safest usage is to choose a product that already belongs to the same branch as the purchase order.

## Stock Transfer API

Backend location: `backend/inventory/views.py`

Products support a branch transfer endpoint:

```text
POST /api/v1/inventory/products/:id/transfer/
```

Expected payload:

```json
{
  "to_branch": 2,
  "quantity": 5,
  "note": "Moved to CBD shop"
}
```

Behavior:

- subtracts quantity from source product
- finds or creates matching product in destination branch using the same SKU
- adds quantity to destination product
- records a `StockTransfer`

Backend models:

- `StockTransfer.from_branch`
- `StockTransfer.to_branch`
- `StockTransfer.product`
- `StockTransfer.quantity`
- `StockTransfer.note`

Current note: this endpoint exists on the backend, but the frontend does not currently expose a stock transfer form.

## Staff Branch Support

Backend location:

- `backend/accounts/models.py`
- `backend/accounts/serializers.py`

The Staff model has a branch field:

```python
branch = models.ForeignKey("inventory.Branch", ...)
```

The staff serializer exposes:

```python
branch_name = serializers.CharField(source="branch.name", read_only=True)
```

Frontend store type:

```ts
branchId?: string;
branchName?: string;
```

Current note: the Staff page currently has inputs for `Full Name` and `Role`, but it does not show a branch select input yet. The data model is ready for branch-linked staff, but the frontend form needs a branch dropdown and API save flow to fully activate it.

## Reports Integration

Location: `src/pages/Reports.tsx`

The Stock Movement Report export includes branch data.

CSV columns include:

```text
Currency,Product,SKU,Category,Branch,Stock,Reorder Level,Cost,Price,Margin %,Status,Value,Cost Value,Added Date,Last Restocked
```

Branch value:

```ts
p.branchName || "Main"
```

Comment: inventory exports are branch-aware, so the business can see which location holds each product.

Current note: reports show/export branch names for inventory, but there is no branch-level report filter in the Reports UI yet.

## Shared Frontend Store

Location: `src/lib/store.tsx`

The shared store defines branch-aware data shapes.

### Product Branch Fields

```ts
branchId?: string;
branchName?: string;
```

### Sale Branch Field

```ts
branchId?: string;
```

### Staff Branch Fields

```ts
branchId?: string;
branchName?: string;
```

### Branch Type

```ts
export interface Branch {
  id: string;
  name: string;
  code: string;
  phone: string;
  address: string;
  isPrimary: boolean;
}
```

### Branch Store Actions

```ts
addBranch()
updateBranch()
deleteBranch()
```

Comment: these allow local branch management and keep the UI responsive even when the server call fails.

## API Layer

Location: `src/lib/api.ts`

Branch API functions:

```ts
listBranchesApi()
createBranchApi()
updateBranchApi()
deleteBranchApi()
```

Product API branch inputs:

```ts
branch?: string;
```

Purchase order branch input:

```ts
branch?: number | null;
```

Till branch input:

```ts
branch?: number | null;
```

Comment: the API layer maps frontend string IDs to backend numeric IDs before sending data where needed.

## Server Data Sync

Location: `src/lib/sync.ts`

When the user logs in or refreshes, the app loads server data from:

```text
GET /api/v1/inventory/branches/
GET /api/v1/inventory/products/
GET /api/v1/sales/
GET /api/v1/accounts/staff/
```

Branch records are mapped into the local store:

```ts
const branches: Branch[] = rawBranches.map(...)
```

Product branch data is mapped:

```ts
branchId: p.branch ? String(p.branch) : undefined,
branchName: p.branch_name || "",
```

Sale branch data is mapped:

```ts
branchId: s.branch ? String(s.branch) : undefined,
```

Staff branch data is mapped:

```ts
branchId: s.branch ? String(s.branch) : undefined,
branchName: s.branch_name || "",
```

Comment: this keeps branch names and IDs available across tabs after server hydration.

## Offline Queue Integration

Locations:

- `src/pages/Inventory.tsx`
- `src/lib/offlineQueue.ts`
- `backend/sync/views.py`

Offline product create/update payloads include:

```ts
branch: form.branchId || undefined
```

Backend sync uses:

```python
"branch": payload.get("branch")
```

Comment: branch assignment is preserved when product changes are queued offline and later synced.

Current note: offline sale payloads currently do not include branch from the till in the `offlinePayload`. Online sales use `branch: till?.branch || null`, but offline queued sales only include payment, customer, and sale items. If branch-accurate offline sales are required, add branch to the offline sale payload and backend sync handler.

## Backend Data Model Summary

### Branch

Each branch belongs to one user and stores:

- name
- code
- phone
- address
- primary flag

### Product

Each product can belong to one branch:

```python
branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True)
```

### Sale

Each sale can belong to one branch:

```python
branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True)
```

### Till Session

Each till session can belong to one branch:

```python
branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True)
```

### Purchase Order

Each purchase order can belong to one branch:

```python
branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True)
```

### Staff

Each staff member can belong to one branch:

```python
branch = models.ForeignKey("inventory.Branch", on_delete=models.SET_NULL, blank=True, null=True)
```

## Current Strengths

- Branches can be created, edited as primary, deleted, and synced with the backend.
- Products can be assigned to branches.
- Inventory tables and exports display branch names.
- Purchase orders can be assigned to branches.
- Low-stock reorder suggestions preserve product branch context.
- Tills can be opened per branch.
- Sales inherit branch from the open till.
- Backend validates that branch-linked data belongs to the authenticated user.
- Backend blocks branch mismatch between sale branch and product branch.
- Backend has a stock transfer endpoint for moving inventory between branches.

## Current Gaps To Finish Later

- Add a branch filter to Inventory.
- Add a branch filter to Reports.
- Add a branch filter to Sales.
- Add a frontend stock transfer form for the existing transfer API.
- Add branch selection to the Staff add/edit form.
- Include branch in offline queued sales.
- Show branch name in the Sales transaction list.
- Enforce purchase order product branch matching when a purchase order has a branch.
- Consider a safer delete flow for branches that already have products, sales, tills, staff, or purchase orders.

## Recommended User Flow

1. Go to Settings.
2. Add all business branches.
3. Mark the main operating location as Primary.
4. Go to Inventory.
5. Add products and assign each product to the correct branch.
6. Go to Sales.
7. Open a till and select the correct branch.
8. Record sales through that till.
9. Go to Suppliers.
10. Create purchase orders for the branch that needs stock.
11. Use Reports to export stock reports with branch information.

