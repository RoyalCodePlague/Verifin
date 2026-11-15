from datetime import date, timedelta
from decimal import Decimal
import csv
from io import BytesIO, StringIO
from zipfile import ZIP_DEFLATED, ZipFile
from xml.etree import ElementTree as ET
from django.utils import timezone
from decimal import Decimal
from django.db.models import Count, F, Q, Sum
from django.utils.dateparse import parse_date
from django.http import HttpResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from expenses.models import Expense, OtherIncome
from inventory.models import Branch, Product, ProductBatch, PurchaseOrder, StockMovement, SupplierPayment
from sales.models import Sale, SaleItem, SaleReturn
from audits.models import Discrepancy
from customers.models import CreditTransaction, Customer
from billing.services import enforce_feature
from accounts.branch_access import get_staff_member
from accounts.activity import log_staff_activity
from .models import AutomationExecution, AutomationPreferences, AutomationRule, CustomReport
from .serializers import AutomationExecutionSerializer, AutomationPreferencesSerializer, AutomationRuleSerializer, CustomReportSerializer
from . import services


class DailySalesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.localdate()
        total = Sale.objects.filter(created_by=request.user, is_deleted=False, date=today).aggregate(total=Sum("total"))["total"] or 0
        total += services.supply_totals(request.user, today, today + timedelta(days=1))[0]
        return Response({"daily_sales": total})


class WeeklyPerformanceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_reports")
        return Response({"message": "Weekly performance endpoint ready."})


class StockMovementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_reports")
        count = StockMovement.objects.filter(created_by=request.user).count()
        return Response({"stock_movements": count})


class ExpenseAnalysisView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.localdate()
        raw_start = request.query_params.get("start_date")
        raw_end = request.query_params.get("end_date")
        if raw_start or raw_end:
            start = parse_date(raw_start or "")
            inclusive_end = parse_date(raw_end or "")
            if not start or not inclusive_end:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"date_range": "Provide valid start_date and end_date values."})
            if start > inclusive_end:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"date_range": "start_date must be on or before end_date."})
            end = inclusive_end + timedelta(days=1)
        else:
            start = today.replace(day=1)
            end = today + timedelta(days=1)

        expenses = Expense.objects.filter(
            created_by=request.user,
            is_deleted=False,
            approval_status="approved",
            date__gte=start,
            date__lt=end,
        ).select_related("category__parent", "branch", "created_by_staff")
        staff = get_staff_member(request)
        if staff:
            expenses = expenses.filter(branch_id=staff.branch_id) if staff.branch_id else expenses.none()
        elif request.query_params.get("branch"):
            try:
                branch_id = int(request.query_params["branch"])
            except (TypeError, ValueError):
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"branch": "Choose a valid branch."})
            if not Branch.objects.filter(pk=branch_id, user=request.user, is_deleted=False).exists():
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"branch": "Branch does not belong to this business."})
            expenses = expenses.filter(branch_id=branch_id)
        for param, lookup in (("category", "category_id"), ("employee", "created_by_staff_id")):
            value = request.query_params.get(param)
            if value:
                try:
                    value = int(value)
                except (TypeError, ValueError):
                    from rest_framework.exceptions import ValidationError
                    raise ValidationError({param: "Choose a valid value."})
                expenses = expenses.filter(**{lookup: value})
        expense_type = request.query_params.get("expense_type")
        if expense_type:
            if expense_type not in ("operating", "other"):
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"expense_type": "Choose operating or other."})
            expenses = expenses.filter(expense_type=expense_type)

        total = expenses.aggregate(total=Sum("amount_base"))["total"] or Decimal("0.00")
        prior_duration = end - start
        previous_total = Expense.objects.filter(
            created_by=request.user,
            is_deleted=False,
            approval_status="approved",
            date__gte=start - prior_duration,
            date__lt=start,
        )
        if staff:
            previous_total_query = previous_total.filter(branch_id=staff.branch_id) if staff.branch_id else previous_total.none()
        elif request.query_params.get("branch"):
            previous_total_query = previous_total.filter(branch_id=request.query_params["branch"])
        else:
            previous_total_query = previous_total
        for param, lookup in (("category", "category_id"), ("employee", "created_by_staff_id")):
            value = request.query_params.get(param)
            if value:
                previous_total_query = previous_total_query.filter(**{lookup: value})
        if expense_type:
            previous_total_query = previous_total_query.filter(expense_type=expense_type)
        previous_total = previous_total_query.aggregate(total=Sum("amount_base"))["total"] or Decimal("0.00")
        category_rows = expenses.values("category__name", "category__parent__name").annotate(
            total=Sum("amount_base"), count=Count("id")
        ).order_by("category__parent__name", "category__name")
        employee_rows = expenses.values("created_by_staff__name").annotate(
            total=Sum("amount_base"), count=Count("id")
        ).order_by("created_by_staff__name")
        branch_rows = expenses.values("branch__name").annotate(
            total=Sum("amount_base"), count=Count("id")
        ).order_by("branch__name")
        change = total - previous_total
        return Response({
            "total_expenses": total,
            "expense_count": expenses.count(),
            "start_date": start,
            "end_date": end - timedelta(days=1),
            "comparison": {
                "previous_total": previous_total,
                "change": change,
                "change_percent": (change / previous_total * 100) if previous_total else None,
            },
            "by_category": [{
                "category": (f"{row['category__parent__name']} / " if row["category__parent__name"] else "") + (row["category__name"] or "Other"),
                "amount": row["total"] or Decimal("0.00"),
                "count": row["count"],
            } for row in category_rows],
            "by_employee": [{
                "employee": row["created_by_staff__name"] or "Business owner",
                "amount": row["total"] or Decimal("0.00"),
                "count": row["count"],
            } for row in employee_rows],
            "by_branch": [{
                "branch": row["branch__name"] or "Business-wide",
                "amount": row["total"] or Decimal("0.00"),
                "count": row["count"],
            } for row in branch_rows],
        })


class ProfitLossView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_analytics")
        period = request.query_params.get("period", "this_month")
        today = timezone.localdate()
        start, end = self._period_range(request, period, today)
        previous_start, previous_end = self._comparison_range(period, start, end)
        branch_ids = self._requested_branches(request)
        if branch_ids is not None and len(branch_ids) == 1:
            branch = Branch.objects.get(pk=branch_ids[0], user=request.user, is_deleted=False)
            start = max(start, branch.opening_date)
            previous_start = max(previous_start, branch.opening_date)
        current = self._summarize(request.user, start, end, branch_ids)
        previous = self._summarize(request.user, previous_start, previous_end, branch_ids)
        comparison = {}
        for field in current:
            change = current[field] - previous[field]
            comparison[field] = {
                "change": change,
                "change_percent": (change / previous[field] * 100) if previous[field] else None,
            }
        return Response({
            "period": period,
            "start_date": start,
            "end_date": end - timedelta(days=1),
            "previous_start_date": previous_start,
            "previous_end_date": previous_end - timedelta(days=1),
            "branches": branch_ids,
            "currency": request.user.currency,
            "current": current,
            "previous": previous,
            "comparison": comparison,
        })

    @staticmethod
    def _requested_branches(request):
        staff = get_staff_member(request)
        if staff:
            return [staff.branch_id] if staff.branch_id else []
        raw_branch = request.query_params.get("branch")
        if not raw_branch:
            return None
        try:
            branch_id = int(raw_branch)
        except (TypeError, ValueError):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"branch": "Choose a valid branch."})
        if not Branch.objects.filter(pk=branch_id, user=request.user, is_deleted=False).exists():
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"branch": "Branch does not belong to this business."})
        return [branch_id]

    @staticmethod
    def _period_range(request, period, today):
        if period == "custom":
            start = parse_date(request.query_params.get("start_date", ""))
            inclusive_end = parse_date(request.query_params.get("end_date", ""))
            if not start or not inclusive_end:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"date_range": "Custom ranges require valid start_date and end_date values."})
            if start > inclusive_end:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"date_range": "start_date must be on or before end_date."})
            return start, inclusive_end + timedelta(days=1)

        if period == "today":
            start = today
        elif period == "this_week":
            start = today - timedelta(days=today.weekday())
        elif period == "this_month":
            start = today.replace(day=1)
        elif period == "previous_month":
            start = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
            return start, (today.replace(day=1))
        elif period == "this_quarter":
            start = date(today.year, ((today.month - 1) // 3) * 3 + 1, 1)
        elif period == "this_year":
            start = date(today.year, 1, 1)
        else:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"period": "Choose today, this_week, this_month, previous_month, this_quarter, this_year, or custom."})
        return start, today + timedelta(days=1)

    @staticmethod
    def _comparison_range(period, start, end):
        duration = end - start
        if period == "previous_month":
            previous_end = start
            previous_start = (start - timedelta(days=1)).replace(day=1)
            return previous_start, previous_end
        if period == "this_month":
            previous_start = (start - timedelta(days=1)).replace(day=1)
            return previous_start, min(previous_start + duration, start)
        if period == "this_quarter":
            previous_month = start.month - 3
            previous_year = start.year
            if previous_month <= 0:
                previous_month += 12
                previous_year -= 1
            previous_start = date(previous_year, previous_month, 1)
            return previous_start, min(previous_start + duration, start)
        if period == "this_year":
            previous_start = date(start.year - 1, 1, 1)
            return previous_start, min(previous_start + duration, start)
        return start - duration, start

    @staticmethod
    def _summarize(user, start, end, branch_ids=None):
        sales = Sale.objects.filter(
            created_by=user,
            is_deleted=False,
            date__gte=start,
            date__lt=end,
        )
        if branch_ids is not None:
            sales = sales.filter(branch_id__in=branch_ids)
        sale_totals = sales.aggregate(
            revenue=Sum("total"),
            cost=Sum("total_cost"),
        )
        sale_cash_received = Decimal("0")
        for allocations, sale_total, payment_method in sales.values_list("payment_allocations", "total", "payment_method"):
            if not allocations:
                if payment_method != "Credit":
                    sale_cash_received += sale_total
                continue
            for allocation in allocations:
                amount_base = allocation.get("amount_base")
                if amount_base is None:
                    amount_base = Decimal(str(allocation.get("amount", "0"))) * Decimal(str(allocation.get("fx_rate_to_base", "1")))
                sale_cash_received += Decimal(str(amount_base))
        customer_payments = CreditTransaction.objects.filter(
            customer__user=user,
            customer__is_deleted=False,
            type="payment",
            is_deleted=False,
            created_at__date__gte=start,
            created_at__date__lt=end,
        )
        if branch_ids is not None:
            customer_payments = customer_payments.filter(customer__branch_id__in=branch_ids)
        sale_cash_received += customer_payments.aggregate(total=Sum("amount"))["total"] or Decimal("0")
        discount_items = SaleItem.objects.filter(
            sale__created_by=user,
            sale__is_deleted=False,
            sale__date__gte=start,
            sale__date__lt=end,
            is_deleted=False,
        )
        if branch_ids is not None:
            discount_items = discount_items.filter(sale__branch_id__in=branch_ids)
        discounts = discount_items.aggregate(
            total=Sum(F("discount_amount") * F("quantity")),
        )["total"] or Decimal("0")
        returns_query = SaleReturn.objects.filter(
            sale_item__sale__created_by=user,
            sale_item__sale__is_deleted=False,
            return_date__gte=start,
            return_date__lt=end,
            is_deleted=False,
        )
        if branch_ids is not None:
            returns_query = returns_query.filter(sale_item__sale__branch_id__in=branch_ids)
        returns = returns_query.aggregate(
            refund=Sum("refund_amount"),
            cost=Sum("cost_amount"),
        )
        cash_refunds = returns_query.exclude(refund_method="Credit").aggregate(
            refund=Sum("refund_amount"),
        )["refund"] or Decimal("0")
        return_revenue = returns["refund"] or Decimal("0")
        returned_cost = returns["cost"] or Decimal("0")
        supply_revenue, supply_cost = services.supply_totals(user, start, end, branch_ids)
        gross_sales = (sale_totals["revenue"] or Decimal("0")) + discounts + supply_revenue
        net_sales = gross_sales - discounts - return_revenue
        cogs = (sale_totals["cost"] or Decimal("0")) + supply_cost - returned_cost
        expenses = Expense.objects.filter(
            created_by=user,
            is_deleted=False,
            approval_status="approved",
            date__gte=start,
            date__lt=end,
        )
        if branch_ids is not None:
            expenses = expenses.filter(branch_id__in=branch_ids)
        expense_totals = expenses.aggregate(
            operating=Sum("amount_base", filter=Q(expense_type="operating")),
            other=Sum("amount_base", filter=Q(expense_type="other")),
        )
        incomes = OtherIncome.objects.filter(
            created_by=user,
            is_deleted=False,
            date__gte=start,
            date__lt=end,
        )
        if branch_ids is not None:
            incomes = incomes.filter(branch_id__in=branch_ids)
        other_income = incomes.aggregate(total=Sum("amount_base"))["total"] or Decimal("0")
        other_income_cash = Decimal("0")
        for allocations, amount_base in incomes.values_list("payment_allocations", "amount_base"):
            if not allocations:
                other_income_cash += amount_base
                continue
            other_income_cash += sum(
                (Decimal(str(row.get("amount_base", "0"))) for row in allocations),
                Decimal("0"),
            )
        supplier_payments = SupplierPayment.objects.filter(
            user=user,
            is_deleted=False,
            payment_date__gte=start,
            payment_date__lt=end,
        )
        if branch_ids is not None:
            supplier_payments = supplier_payments.filter(purchase_order__branch_id__in=branch_ids)
        supplier_payments = supplier_payments.aggregate(total=Sum("amount_base"))["total"] or Decimal("0")
        operating_expenses = expense_totals["operating"] or Decimal("0")
        other_expenses = expense_totals["other"] or Decimal("0")
        gross_profit = net_sales - cogs
        net_profit = gross_profit - operating_expenses + other_income - other_expenses
        return {
            "gross_sales": gross_sales,
            "discounts": discounts,
            "sales_returns": return_revenue,
            "net_sales": net_sales,
            "cost_of_goods_sold": cogs,
            "gross_profit": gross_profit,
            "operating_expenses": operating_expenses,
            "other_income": other_income,
            "other_expenses": other_expenses,
            "net_profit": net_profit,
            "cash_received": sale_cash_received + supply_revenue - cash_refunds + other_income_cash,
            "supplier_payments": supplier_payments,
        }


class MarginReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_analytics")
        rows = []
        for product in Product.objects.filter(user=request.user, is_deleted=False):
            revenue = Sale.objects.filter(created_by=request.user, is_deleted=False, sale_items__product=product).aggregate(total=Sum("sale_items__subtotal"))["total"] or 0
            cost = Sale.objects.filter(created_by=request.user, is_deleted=False, sale_items__product=product).aggregate(total=Sum("sale_items__cost_total"))["total"] or 0
            profit = revenue - cost
            margin = (profit / revenue * 100) if revenue else 0
            rows.append({
                "product": product.name,
                "branch": product.branch.name if product.branch else "",
                "revenue": revenue,
                "cost": cost,
                "profit": profit,
                "margin_percent": margin,
                "unit_margin": product.price - product.cost_price,
            })
        return Response({"items": sorted(rows, key=lambda row: row["profit"], reverse=True)})


class ProfitLeakView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_analytics")
        leaks = []
        products = Product.objects.filter(user=request.user, is_deleted=False)

        for product in products:
            if product.price <= product.cost_price:
                leaks.append({
                    "type": "negative_margin",
                    "severity": "critical",
                    "title": f"{product.name} is priced at or below cost",
                    "impact": product.price - product.cost_price,
                    "product": product.name,
                    "sku": product.sku,
                    "suggested_action": "Increase selling price or renegotiate supplier cost.",
                })

        discounted_items = (
            SaleItem.objects.filter(sale__created_by=request.user, is_deleted=False)
            .select_related("product")
            .order_by("-created_at")[:500]
        )
        for item in discounted_items:
            if item.product and item.unit_price < item.product.price:
                leak_amount = (item.product.price - item.unit_price) * item.quantity
                if leak_amount > 0:
                    leaks.append({
                        "type": "discount_leak",
                        "severity": "medium" if leak_amount < Decimal("100") else "high",
                        "title": f"{item.product.name} sold below listed price",
                        "impact": leak_amount,
                        "product": item.product.name,
                        "sku": item.product.sku,
                        "suggested_action": "Review discount approvals and cashier pricing rules.",
                    })

        expense_total = Expense.objects.filter(created_by=request.user, is_deleted=False, approval_status="approved").aggregate(total=Sum("amount_base"))["total"] or 0
        gross_profit = Sale.objects.filter(created_by=request.user, is_deleted=False).aggregate(total=Sum("gross_profit"))["total"] or 0
        if gross_profit and expense_total > gross_profit * Decimal("0.35"):
            leaks.append({
                "type": "expense_drag",
                "severity": "high",
                "title": "Expenses are eating into gross profit",
                "impact": expense_total - (gross_profit * Decimal("0.35")),
                "product": "",
                "sku": "",
                "suggested_action": "Inspect recurring expenses and supplier charges this month.",
            })

        zero_cost_count = products.filter(cost_price=0).count()
        if zero_cost_count:
            leaks.append({
                "type": "missing_costs",
                "severity": "medium",
                "title": f"{zero_cost_count} products have no cost price",
                "impact": 0,
                "product": "",
                "sku": "",
                "suggested_action": "Add cost prices so profit reports stop undercounting losses.",
            })

        priority = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        leaks.sort(key=lambda leak: (priority.get(leak["severity"], 9), -Decimal(str(leak["impact"] or 0))))
        return Response({"items": leaks[:30]})


class DiscrepancyReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "discrepancy_tracking")
        rows = Discrepancy.objects.filter(
            audit__conductor=request.user, is_deleted=False, audit__is_deleted=False,
            product__is_deleted=False,
        ).select_related("audit", "product", "resolved_by").order_by("-created_at")
        status_filter = request.query_params.get("status")
        if status_filter in {"unresolved", "investigating", "resolved"}:
            rows = rows.filter(status=status_filter)
        return Response({"count": rows.count(), "items": [{
            "id": item.id, "audit_id": item.audit_id, "audit_date": item.audit.date,
            "product": item.product.name, "sku": item.product.sku,
            "expected_stock": item.expected_stock, "actual_stock": item.actual_stock,
            "difference": item.difference, "status": item.status,
            "resolved_by": item.resolved_by.get_full_name() if item.resolved_by else None,
            "created_at": item.created_at,
        } for item in rows[:500]]})


class CustomerReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_reports")
        customers = Customer.objects.filter(user=request.user, is_deleted=False).order_by("-total_spent")
        return Response({"summary": {
            "customers": customers.count(),
            "total_spent": customers.aggregate(total=Sum("total_spent"))["total"] or 0,
            "total_debt": customers.aggregate(total=Sum("debt_amount"))["total"] or 0,
            "total_visits": customers.aggregate(total=Sum("visits"))["total"] or 0,
        }, "items": [{
            "id": customer.id, "name": customer.name, "phone": customer.phone,
            "total_spent": customer.total_spent, "visits": customer.visits,
            "loyalty_points": customer.loyalty_points, "debt_amount": customer.debt_amount,
            "last_visit": customer.last_visit, "badge": customer.badge,
        } for customer in customers[:500]]})


class MonthlyOverviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_reports")
        today = timezone.localdate()
        months = []
        for offset in range(11, -1, -1):
            month_index = today.year * 12 + today.month - 1 - offset
            year, month_zero = divmod(month_index, 12)
            start = today.replace(year=year, month=month_zero + 1, day=1)
            end_index = month_index + 1
            end_year, end_month_zero = divmod(end_index, 12)
            end = start.replace(year=end_year, month=end_month_zero + 1, day=1)
            sales_total = Sale.objects.filter(created_by=request.user, is_deleted=False, date__gte=start, date__lt=end).aggregate(total=Sum("total"))["total"] or 0
            cost_total = Sale.objects.filter(created_by=request.user, is_deleted=False, date__gte=start, date__lt=end).aggregate(total=Sum("total_cost"))["total"] or 0
            expense_total = Expense.objects.filter(created_by=request.user, is_deleted=False, approval_status="approved", date__gte=start, date__lt=end).aggregate(total=Sum("amount_base"))["total"] or 0
            supply_revenue, supply_cost = services.supply_totals(request.user, start, end)
            revenue = sales_total + supply_revenue
            cost = cost_total + supply_cost
            months.append({"month": start.strftime("%Y-%m"), "sales": revenue, "cost_of_goods": cost,
                           "gross_profit": revenue - cost, "expenses": expense_total,
                           "net_profit": revenue - cost - expense_total})
        return Response({"months": months})


class AdvancedAnalyticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_analytics")
        return Response(services.advanced_analytics(request.user))


class ForecastView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "forecasting")
        days = int(request.query_params.get("days", 7))
        return Response(services.rule_forecast(request.user, days=days))


class AutomationAlertsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "automation_rules")
        return Response(services.automation_alerts(request.user))


class AutomationPreferencesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "automation_rules")
        preferences, _ = AutomationPreferences.objects.get_or_create(user=request.user)
        return Response(AutomationPreferencesSerializer(preferences).data)

    def patch(self, request):
        enforce_feature(request.user, "automation_rules")
        preferences, _ = AutomationPreferences.objects.get_or_create(user=request.user)
        serializer = AutomationPreferencesSerializer(preferences, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class AutomationRuleViewSet(viewsets.ModelViewSet):
    serializer_class = AutomationRuleSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        enforce_feature(request.user, "automation_rules")
        if getattr(request, "api_key", None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("API keys cannot manage automation rules.")
        from accounts.branch_access import require_business_owner
        require_business_owner(request)

    def get_queryset(self):
        return AutomationRule.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        rule = serializer.save(user=self.request.user)
        log_staff_activity(
            self.request.user, "automation_rule_created", f"Created automation rule {rule.name}",
            actor=self.request.user, request=self.request, object_type="automation_rule", object_id=rule.id,
            metadata={"after": {"trigger": rule.trigger, "conditions": rule.conditions, "action": rule.action, "enabled": rule.enabled}},
        )

    def perform_update(self, serializer):
        before = {"trigger": serializer.instance.trigger, "conditions": serializer.instance.conditions,
                  "action": serializer.instance.action, "enabled": serializer.instance.enabled}
        rule = serializer.save()
        log_staff_activity(
            self.request.user, "automation_rule_updated", f"Updated automation rule {rule.name}",
            actor=self.request.user, request=self.request, object_type="automation_rule", object_id=rule.id,
            metadata={"before": before, "after": {"trigger": rule.trigger, "conditions": rule.conditions,
                                                     "action": rule.action, "enabled": rule.enabled}},
        )

    def perform_destroy(self, instance):
        name, rule_id = instance.name, instance.id
        instance.is_deleted = True
        instance.enabled = False
        instance.save(update_fields=["is_deleted", "enabled", "updated_at"])
        log_staff_activity(
            self.request.user, "automation_rule_deleted", f"Deleted automation rule {name}",
            actor=self.request.user, request=self.request, object_type="automation_rule", object_id=rule_id,
        )


class AutomationExecutionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AutomationExecutionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        enforce_feature(request.user, "automation_rules")
        if getattr(request, "api_key", None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("API keys cannot view automation execution history.")
        from accounts.branch_access import require_business_owner
        require_business_owner(request)

    def get_queryset(self):
        queryset = AutomationExecution.objects.filter(user=self.request.user).select_related("rule").order_by("-created_at", "-id")
        rule_id = self.request.query_params.get("rule")
        if rule_id:
            if not rule_id.isdigit():
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"rule": "Rule id must be a number."})
            queryset = queryset.filter(rule_id=rule_id)
        return queryset

    def list(self, request, *args, **kwargs):
        return Response(self.get_serializer(self.get_queryset()[:100], many=True).data)

    @action(detail=True, methods=["post"], url_path="retry")
    def retry(self, request, pk=None):
        execution = self.get_object()
        from .automation_engine import retry_automation_execution
        try:
            execution = retry_automation_execution(execution)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(self.get_serializer(execution).data)


class CustomReportViewSet(viewsets.ModelViewSet):
    serializer_class = CustomReportSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        enforce_feature(request.user, "custom_reports")
        if getattr(request, "api_key", None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("API keys cannot manage saved custom report templates.")

    def get_queryset(self):
        return CustomReport.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted", "updated_at"])

    @action(detail=True, methods=["get"], url_path="run")
    def run(self, request, pk=None):
        report = self.get_object()
        rows = services.run_custom_report(request.user, report, request=request)
        return Response({"report": self.get_serializer(report).data, "rows": rows})

    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request, pk=None):
        report = self.get_object()
        export_format = request.query_params.get("export_format", "csv").lower()
        if export_format not in {"csv", "xlsx", "pdf"}:
            return Response({"detail": "Supported formats are csv, xlsx, and pdf."}, status=400)
        if export_format == "xlsx":
            enforce_feature(request.user, "excel_exports")
        rows = services.run_custom_report(request.user, report, request=request)
        metric_labels = {"sales": "Sales", "profit": "Gross profit", "transactions": "Transactions"}
        selected_metrics = report.metrics or [report.metric]
        headers = ["Period", *[metric_labels[metric] for metric in selected_metrics]]
        export_rows = [
            [row["period"], *[
                row.get("values", {selected_metrics[0]: row["value"]})[metric]
                for metric in selected_metrics
            ]]
            for row in rows
        ]
        filename = f"custom-report-{report.pk}.{export_format}"
        if export_format == "csv":
            output = StringIO()
            writer = csv.writer(output)
            writer.writerow(headers)
            writer.writerows(export_rows)
            response = HttpResponse(output.getvalue(), content_type="text/csv; charset=utf-8")
        elif export_format == "xlsx":
            response = HttpResponse(_custom_report_xlsx(headers, export_rows), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        else:
            from reportlab.lib import colors
            from reportlab.lib.pagesizes import letter
            from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

            output = BytesIO()
            document = SimpleDocTemplate(output, pagesize=letter, title=report.name)
            table = Table([headers, *[[str(value) for value in row] for row in export_rows]], repeatRows=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#164e3f")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d8d8d0")),
                ("PADDING", (0, 0), (-1, -1), 7),
            ]))
            document.build([table])
            response = HttpResponse(output.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


def _custom_report_xlsx(headers, rows):
    main_ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    package_rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    content_ns = "http://schemas.openxmlformats.org/package/2006/content-types"
    ET.register_namespace("", main_ns)
    ET.register_namespace("r", rel_ns)

    def column_name(number):
        name = ""
        while number:
            number, remainder = divmod(number - 1, 26)
            name = chr(65 + remainder) + name
        return name

    sheet = ET.Element(f"{{{main_ns}}}worksheet")
    sheet_data = ET.SubElement(sheet, f"{{{main_ns}}}sheetData")
    values = [headers, *rows]
    for row_index, values_row in enumerate(values, start=1):
        row_element = ET.SubElement(sheet_data, f"{{{main_ns}}}row", {"r": str(row_index)})
        for column_index, value in enumerate(values_row, start=1):
            reference = f"{column_name(column_index)}{row_index}"
            if row_index > 1 and column_index > 1:
                cell = ET.SubElement(row_element, f"{{{main_ns}}}c", {"r": reference})
                ET.SubElement(cell, f"{{{main_ns}}}v").text = str(value)
            else:
                cell = ET.SubElement(row_element, f"{{{main_ns}}}c", {"r": reference, "t": "inlineStr"})
                inline = ET.SubElement(cell, f"{{{main_ns}}}is")
                ET.SubElement(inline, f"{{{main_ns}}}t").text = str(value)

    workbook = ET.Element(f"{{{main_ns}}}workbook")
    sheets = ET.SubElement(workbook, f"{{{main_ns}}}sheets")
    ET.SubElement(sheets, f"{{{main_ns}}}sheet", {"name": "Custom Report", "sheetId": "1", f"{{{rel_ns}}}id": "rId1"})
    relationships = ET.Element(f"{{{package_rel_ns}}}Relationships")
    ET.SubElement(relationships, f"{{{package_rel_ns}}}Relationship", {
        "Id": "rId1", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", "Target": "worksheets/sheet1.xml",
    })
    root_rels = ET.Element(f"{{{package_rel_ns}}}Relationships")
    ET.SubElement(root_rels, f"{{{package_rel_ns}}}Relationship", {
        "Id": "rId1", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "Target": "xl/workbook.xml",
    })
    content_types = ET.Element(f"{{{content_ns}}}Types")
    ET.SubElement(content_types, f"{{{content_ns}}}Default", {"Extension": "rels", "ContentType": "application/vnd.openxmlformats-package.relationships+xml"})
    ET.SubElement(content_types, f"{{{content_ns}}}Default", {"Extension": "xml", "ContentType": "application/xml"})
    ET.SubElement(content_types, f"{{{content_ns}}}Override", {"PartName": "/xl/workbook.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"})
    ET.SubElement(content_types, f"{{{content_ns}}}Override", {"PartName": "/xl/worksheets/sheet1.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"})

    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path, element in {
            "[Content_Types].xml": content_types,
            "_rels/.rels": root_rels,
            "xl/workbook.xml": workbook,
            "xl/_rels/workbook.xml.rels": relationships,
            "xl/worksheets/sheet1.xml": sheet,
        }.items():
            archive.writestr(path, ET.tostring(element, encoding="utf-8", xml_declaration=True))
    return output.getvalue()


class ExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        export_type = request.query_params.get("type", "csv")
        if export_type in ["excel", "xlsx"]:
            enforce_feature(request.user, "excel_exports")
        if export_type not in {"csv", "excel", "xlsx"}:
            return Response({"detail": "Supported export types are csv and excel."}, status=400)
        report_type = request.query_params.get("report", "monthly-overview")
        if report_type == "monthly-overview":
            enforce_feature(request.user, "advanced_reports")
            data = MonthlyOverviewView().get(request).data["months"]
            headers = ["month", "sales", "cost_of_goods", "gross_profit", "expenses", "net_profit"]
        elif report_type == "customers":
            enforce_feature(request.user, "advanced_reports")
            data = CustomerReportView().get(request).data["items"]
            headers = ["id", "name", "phone", "total_spent", "visits", "loyalty_points", "debt_amount", "last_visit", "badge"]
        elif report_type == "discrepancies":
            enforce_feature(request.user, "discrepancy_tracking")
            data = DiscrepancyReportView().get(request).data["items"]
            headers = ["id", "audit_id", "audit_date", "product", "sku", "expected_stock", "actual_stock", "difference", "status", "created_at"]
        else:
            return Response({"detail": "Unknown report. Use monthly-overview, customers, or discrepancies."}, status=400)
        import csv
        from io import StringIO
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        for item in data:
            writer.writerow([item.get(field, "") for field in headers])
        response = HttpResponse(output.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{report_type}.csv"'
        return response
