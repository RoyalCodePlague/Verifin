from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.branch_access import get_staff_member
from billing.services import enforce_feature
from customers.models import Customer
from inventory.models import (
    Branch,
    Product,
    PurchaseOrder,
    StockTransfer,
    SupplierPayment,
    SupplierReturnItem,
)
from inventory.supplier_financial_services import get_purchase_orders_received_totals_base
from .views import ProfitLossView


class BranchOverviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "multi_branch")
        branches, branch_ids, include_unassigned = self._selected_branches(request)
        period = request.query_params.get("period", "this_month")
        today = timezone.localdate()
        start, end = ProfitLossView._period_range(request, period, today)
        previous_start, previous_end = ProfitLossView._comparison_range(period, start, end)

        rows = []
        for branch in branches:
            branch_start = max(start, branch.opening_date)
            previous_branch_start = max(previous_start, branch.opening_date)
            current = ProfitLossView._summarize(request.user, branch_start, end, [branch.id])
            previous = ProfitLossView._summarize(request.user, previous_branch_start, previous_end, [branch.id])
            current_days = max((end - branch_start).days, 0)
            previous_days = max((previous_end - previous_branch_start).days, 0)
            inventory_cost, inventory_retail = self._inventory_value(request.user, [branch.id])
            customer_debt = Customer.objects.filter(
                user=request.user,
                branch=branch,
                is_deleted=False,
            ).aggregate(total=Sum("debt_amount"))["total"] or Decimal("0")
            supplier_debt = self._supplier_debt(request.user, [branch.id])
            in_transit = sum(
                transfer.quantity_in_transit
                for transfer in StockTransfer.objects.filter(
                    created_by=request.user,
                    from_branch=branch,
                    is_deleted=False,
                ).exclude(status__in=[
                    StockTransfer.STATUS_COMPLETED,
                    StockTransfer.STATUS_CANCELLED,
                    StockTransfer.STATUS_REJECTED,
                ])
            )
            metrics = {
                "sales": "net_sales",
                "gross_profit": "gross_profit",
                "net_profit": "net_profit",
                "expenses": "operating_expenses",
            }
            comparisons = {}
            for name, field in metrics.items():
                current_daily = current[field] / current_days if current_days else None
                previous_daily = previous[field] / previous_days if previous_days else None
                comparisons[name] = {
                    "current": current[field],
                    "previous": previous[field],
                    "current_per_operating_day": current_daily,
                    "previous_per_operating_day": previous_daily,
                    "change_percent": (
                        (current_daily - previous_daily) / abs(previous_daily) * 100
                        if current_daily is not None and previous_daily not in (None, Decimal("0"))
                        else None
                    ),
                    "comparison_available": previous_days > 0,
                }
            rows.append({
                "id": branch.id,
                "name": branch.name,
                "opening_date": branch.opening_date,
                "current_period": {"start_date": branch_start, "end_date": end - timedelta(days=1)},
                "comparison_period": {
                    "start_date": previous_branch_start,
                    "end_date": previous_end - timedelta(days=1),
                    "operating_days": previous_days,
                },
                "current_operating_days": current_days,
                "current": current,
                "previous": previous,
                "comparisons": comparisons,
                "inventory": {
                    "cost_value": inventory_cost,
                    "retail_value": inventory_retail,
                },
                "customer_outstanding": customer_debt,
                "supplier_outstanding": supplier_debt,
                "outgoing_stock_in_transit": in_transit,
            })

        total_branch_ids = None if include_unassigned else branch_ids
        total = ProfitLossView._summarize(request.user, start, end, total_branch_ids)
        previous_total = ProfitLossView._summarize(
            request.user, previous_start, previous_end, total_branch_ids
        )
        inventory_cost, inventory_retail = self._inventory_value(
            request.user, total_branch_ids
        )
        customer_debt_query = Customer.objects.filter(user=request.user, is_deleted=False)
        if total_branch_ids is not None:
            customer_debt_query = customer_debt_query.filter(branch_id__in=total_branch_ids)
        customer_debt = customer_debt_query.aggregate(total=Sum("debt_amount"))["total"] or Decimal("0")
        supplier_debt = self._supplier_debt(request.user, total_branch_ids)
        return Response({
            "period": period,
            "start_date": start,
            "end_date": end - timedelta(days=1),
            "previous_start_date": previous_start,
            "previous_end_date": previous_end - timedelta(days=1),
            "selected_branches": branch_ids,
            "includes_unassigned_records": include_unassigned,
            "branches": rows,
            "total": total,
            "previous_total": previous_total,
            "inventory": {
                "cost_value": inventory_cost,
                "retail_value": inventory_retail,
            },
            "customer_outstanding": customer_debt,
            "supplier_outstanding": supplier_debt,
        })

    @staticmethod
    def _selected_branches(request):
        staff = get_staff_member(request)
        queryset = Branch.objects.filter(user=request.user, is_deleted=False).order_by("name", "id")
        if staff:
            branches = list(queryset.filter(pk=staff.branch_id)) if staff.branch_id else []
            return branches, [branch.id for branch in branches], False

        raw = request.query_params.get("branches", "all").strip()
        if raw == "all":
            branches = list(queryset)
            return branches, [branch.id for branch in branches], True
        try:
            branch_ids = list(dict.fromkeys(int(value) for value in raw.split(",") if value))
        except ValueError:
            raise ValidationError({"branches": "Use 'all' or a comma-separated list of branch IDs."})
        branches = list(queryset.filter(id__in=branch_ids))
        if len(branches) != len(branch_ids):
            raise ValidationError({"branches": "One or more branches do not belong to this business."})
        return branches, branch_ids, False

    @staticmethod
    def _inventory_value(user, branch_ids):
        products = Product.objects.filter(user=user, is_deleted=False).prefetch_related("batches")
        if branch_ids is not None:
            products = products.filter(branch_id__in=branch_ids)
        cost_value = Decimal("0")
        retail_value = Decimal("0")
        for product in products:
            batches = [batch for batch in product.batches.all() if not batch.is_deleted]
            tracked_quantity = sum(batch.quantity_remaining for batch in batches)
            cost_value += sum(
                (Decimal(batch.quantity_remaining) * batch.unit_cost_base for batch in batches),
                Decimal("0"),
            )
            untracked_quantity = max(product.stock - tracked_quantity, 0)
            cost_value += (
                Decimal(untracked_quantity)
                * product.cost_price
                * product.cost_fx_rate_to_base
            )
            retail_value += Decimal(product.stock) * product.price
        return cost_value.quantize(Decimal("0.01")), retail_value.quantize(Decimal("0.01"))

    @staticmethod
    def _supplier_debt(user, branch_ids):
        orders = PurchaseOrder.objects.filter(
            user=user,
            is_deleted=False,
            status__in=[
                PurchaseOrder.STATUS_APPROVED,
                PurchaseOrder.STATUS_PARTIALLY_RECEIVED,
                PurchaseOrder.STATUS_FULLY_RECEIVED,
                PurchaseOrder.STATUS_COMPLETED,
            ],
        )
        if branch_ids is not None:
            orders = orders.filter(branch_id__in=branch_ids)
        orders = list(orders)
        order_ids = [order.id for order in orders]
        received = get_purchase_orders_received_totals_base(orders)
        payments = dict(
            SupplierPayment.objects.filter(
                user=user,
                is_deleted=False,
                purchase_order_id__in=order_ids,
            ).values("purchase_order_id").annotate(total=Sum("amount_base")).values_list(
                "purchase_order_id", "total"
            )
        )
        returns = dict(
            SupplierReturnItem.objects.filter(
                supplier_return__user=user,
                supplier_return__is_deleted=False,
                supplier_return__purchase_order_id__in=order_ids,
                is_deleted=False,
            ).values("supplier_return__purchase_order_id").annotate(
                total=Sum("total_amount_base")
            ).values_list("supplier_return__purchase_order_id", "total")
        )
        return sum(
            (
                max(
                    received[order_id]["received_total_base"]
                    - Decimal(payments.get(order_id) or 0)
                    - Decimal(returns.get(order_id) or 0),
                    Decimal("0"),
                )
                for order_id in order_ids
            ),
            Decimal("0"),
        ).quantize(Decimal("0.01"))
