from decimal import Decimal, InvalidOperation
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from customers.models import CreditTransaction, Customer, LoyaltyTransaction
from inventory.models import Product, StockMovement
from django.db.models import Prefetch, Sum
from django.db.models.functions import TruncDay, TruncMonth, TruncWeek
from urllib.parse import quote
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from accounts.activity import log_staff_activity
from accounts.approvals import require_approval_if_over_threshold
from accounts.branch_access import get_staff_member, require_staff_operation, scope_queryset_to_staff_branch
from billing.services import enforce_feature
from core.currency import get_rate_to_base, normalize_allocations
from notifications.models import NotificationLog
from .models import Sale, SaleItem, SaleReturn, TillCashMovement, TillSession
from .serializers import (
    SaleItemReadSerializer,
    SaleItemSerializer,
    SaleReturnSerializer,
    SaleSerializer,
    TillCashMovementCreateSerializer,
    TillCashMovementSerializer,
    TillSessionCloseSerializer,
    TillSessionSerializer,
)


def build_receipt_payload(sale, user):
    return {
        "receipt_number": sale.receipt_number,
        "invoice_number": sale.invoice_number,
        "business_name": user.business_name,
        "branch": sale.branch.name if sale.branch else "",
        "date": sale.date,
        "time": sale.time,
        "payment_method": sale.payment_method,
        "payment_currency": sale.payment_currency,
        "payment_allocations": sale.payment_allocations,
        "amount_paid_base": sale.amount_paid_base,
        "balance_due": sale.balance_due,
        "due_date": sale.due_date,
        "items": SaleItemReadSerializer(sale.sale_items.all(), many=True).data,
        "subtotal": sale.total,
        "total": sale.total,
        "customer": sale.customer.name if sale.customer else "",
        "customer_phone": sale.customer.phone if sale.customer else "",
    }


def build_receipt_message(payload, currency_symbol):
    lines = [
        payload["business_name"] or "Verifin Receipt",
        f"Receipt: {payload['receipt_number']}",
        f"Invoice: {payload['invoice_number']}" if payload.get("invoice_number") else "",
        f"{payload['date']} {payload['time']}",
        f"Payment: {payload['payment_method']}",
        f"Currency: {payload['payment_currency']}" if payload.get("payment_currency") else "",
        "",
        *[
            f"{item['quantity']} {item.get('product_name') or 'Item'} - {currency_symbol}{item.get('subtotal')}"
            for item in payload["items"]
        ],
        "",
        f"Total: {currency_symbol}{payload['total']}",
        f"Paid: {currency_symbol}{payload['amount_paid_base']}" if payload.get("balance_due", 0) else "",
        f"Balance due: {currency_symbol}{payload['balance_due']}" if payload.get("balance_due", 0) else "",
        f"Due date: {payload['due_date']}" if payload.get("balance_due", 0) and payload.get("due_date") else "",
        "Thank you for shopping with us.",
    ]
    return "\n".join([line for line in lines if line != ""])


class SaleViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "delete", "head", "options"]
    serializer_class = SaleSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["payment_method", "customer"]

    def get_queryset(self):
        sale_items = SaleItem.objects.filter(is_deleted=False).select_related("product").prefetch_related(
            Prefetch(
                "returns",
                queryset=SaleReturn.objects.filter(is_deleted=False),
                to_attr="active_returns",
            )
        )
        queryset = (
            Sale.objects.filter(created_by=self.request.user, is_deleted=False)
            .select_related("branch", "customer", "till_session")
            .prefetch_related(Prefetch("sale_items", queryset=sale_items))
        )
        return scope_queryset_to_staff_branch(self.request, queryset)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if hasattr(request, "api_key") and request.method == "DELETE":
            from accounts.authentication import require_area
            require_area(request, "sales")

    def perform_create(self, serializer):
        till_session = serializer.validated_data.get("till_session")
        if not till_session:
            staff = get_staff_member(self.request)
            till_sessions = TillSession.objects.filter(user=self.request.user, status="open", is_deleted=False)
            if staff:
                till_sessions = till_sessions.filter(branch_id=staff.branch_id)
            till_session = till_sessions.order_by("-opened_at").first()
        sale = serializer.save(created_by=self.request.user, till_session=till_session)
        from core.analytics import record_activation_event
        record_activation_event(self.request.user, "first_sale_recorded")
        log_staff_activity(
            self.request.user,
            "sale_created",
            f"Created sale {sale.receipt_number} for {self.request.user.currency_symbol}{sale.total}",
            actor=self.request.user,
            request=self.request,
            object_type="sale",
            object_id=sale.id,
            metadata={"after": {
                "receipt_number": sale.receipt_number, "total": str(sale.total),
                "amount_paid_base": str(sale.amount_paid_base), "balance_due": str(sale.balance_due),
                "branch_id": sale.branch_id, "customer_id": sale.customer_id,
                "discount_total": str(sum(
                    (item.discount_amount * item.quantity for item in sale.sale_items.all()), Decimal("0"),
                )),
            }},
        )

    def _matches_idempotent_sale(self, sale, validated_data):
        requested_items = sorted(
            (
                item["product"].pk,
                item["quantity"],
                str(Decimal(item["unit_price"]).quantize(Decimal("0.01"))),
                str(Decimal(item.get("discount_amount", 0)).quantize(Decimal("0.01"))),
            )
            for item in validated_data.get("sale_items", [])
        )
        existing_items = sorted(
            (
                item.product_id,
                item.quantity,
                str(item.unit_price.quantize(Decimal("0.01"))),
                str(item.discount_amount.quantize(Decimal("0.01"))),
            )
            for item in sale.sale_items.filter(is_deleted=False)
        )
        if requested_items != existing_items:
            return False

        user = self.request.user
        payment_currency = validated_data.get("payment_currency") or user.currency
        payment_method = validated_data.get("payment_method", Sale._meta.get_field("payment_method").default)
        requested_total = sum(
            ((Decimal(item["unit_price"]) - Decimal(item.get("discount_amount", 0))) * item["quantity"] for item in validated_data.get("sale_items", [])),
            Decimal("0"),
        )
        submitted_allocations = validated_data.get("payment_allocations", [])
        if payment_method == "Credit" and not submitted_allocations:
            expected_allocations = []
        else:
            rate = get_rate_to_base(user, payment_currency) if not submitted_allocations else Decimal("1")
            expected_allocations, _ = normalize_allocations(
                user,
                submitted_allocations,
                (requested_total / rate).quantize(Decimal("0.01")),
                payment_currency,
                rate,
            )
        if payment_method != sale.payment_method or expected_allocations != sale.payment_allocations:
            return False

        branch = validated_data.get("branch")
        customer = validated_data.get("customer")
        if sale.branch_id != getattr(branch, "pk", None) or sale.customer_id != getattr(customer, "pk", None):
            return False
        if sale.due_date != validated_data.get("due_date"):
            return False
        if "till_session" in self.request.data:
            till_session = validated_data.get("till_session")
            if sale.till_session_id != getattr(till_session, "pk", None):
                return False
        return True

    def create(self, request, *args, **kwargs):
        integration_id = str(request.data.get("integration_id") or "").strip()
        if len(integration_id) > 120:
            return Response({"integration_id": ["Ensure this field has no more than 120 characters."]}, status=400)
        if integration_id:
            with transaction.atomic():
                from django.contrib.auth import get_user_model
                get_user_model().objects.select_for_update().get(pk=request.user.pk)
                serializer = self.get_serializer(data=request.data)
                serializer.is_valid(raise_exception=True)
                integration_id = serializer.validated_data.get("integration_id", "")
                existing = Sale.objects.filter(created_by=request.user, integration_id=integration_id).first() if integration_id else None
                if existing:
                    if existing.is_deleted:
                        return Response({"integration_id": ["This receipt ID has already been voided and cannot be reused."]}, status=409)
                    if not self._matches_idempotent_sale(existing, serializer.validated_data):
                        return Response({"integration_id": ["This receipt ID was already used with a different sale payload."]}, status=409)
                    response = Response(self.get_serializer(existing).data, status=200)
                    response["Idempotent-Replay"] = "true"
                    return response
                return super().create(request, *args, **kwargs)
        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def perform_destroy(self, instance):
        require_staff_operation(self.request, "sales.void")
        sale = Sale.objects.select_for_update().get(pk=instance.pk)
        if sale.is_deleted:
            return
        remaining_by_product = {}
        stock_to_restore = {}
        for item in sale.sale_items.filter(is_deleted=False).order_by("product_id"):
            returned_quantity = SaleReturn.objects.filter(
                sale_item=item,
                is_deleted=False,
            ).aggregate(total=Sum("quantity"))["total"] or 0
            remaining_quantity = max(item.quantity - returned_quantity, 0)
            remaining_by_product[item.product_id] = remaining_by_product.get(item.product_id, 0) + remaining_quantity
            stock_to_restore[item.product_id] = stock_to_restore.get(item.product_id, 0) + remaining_quantity

        batch_restored_by_product = {}
        batch_out_movements = StockMovement.objects.filter(
            product__sale_items__sale=sale,
            product__sale_items__is_deleted=False,
            movement_type="out",
            reason=sale.receipt_number,
            batch__isnull=False,
            is_deleted=False,
        ).select_related("batch").order_by("id").distinct()
        for movement in batch_out_movements:
            restore_quantity = min(movement.quantity, remaining_by_product.get(movement.product_id, 0))
            if not restore_quantity:
                continue
            batch = movement.batch
            batch.quantity_remaining += restore_quantity
            batch.save(update_fields=["quantity_remaining", "updated_at"])
            remaining_by_product[movement.product_id] -= restore_quantity
            batch_restored_by_product[movement.product_id] = batch_restored_by_product.get(movement.product_id, 0) + restore_quantity
            StockMovement.objects.create(
                product=movement.product,
                batch=batch,
                quantity=restore_quantity,
                movement_type="in",
                created_by=self.request.user,
                reason=f"Reversed {sale.receipt_number}",
            )
        for product_id, quantity in stock_to_restore.items():
            if not quantity:
                continue
            product = Product.objects.select_for_update().get(pk=product_id)
            product.stock += quantity
            product.save()
            unbatched_quantity = quantity - batch_restored_by_product.get(product_id, 0)
            if unbatched_quantity:
                StockMovement.objects.create(
                    product=product,
                    quantity=unbatched_quantity,
                    movement_type="in",
                    created_by=self.request.user,
                    reason=f"Reversed {sale.receipt_number}",
                )
        from reports.financial_services import reverse_source_account_postings

        reverse_source_account_postings(
            user=sale.created_by,
            source_key=f"sale:{sale.pk}:payment",
            reversal_key=f"sale:{sale.pk}:void",
            transaction_date=timezone.localdate(),
            reason="Sale voided",
            created_by=self.request.user,
        )
        if sale.customer_id:
            customer = Customer.objects.select_for_update().get(pk=sale.customer_id)
            returned_amount = SaleReturn.objects.filter(
                sale_item__sale=sale,
                is_deleted=False,
            ).aggregate(total=Sum("refund_amount"))["total"] or Decimal("0")
            remaining_spend = max(sale.total - returned_amount, Decimal("0"))
            points = int(remaining_spend // 10)
            customer.visits = max(0, customer.visits - 1)
            customer.total_spent -= remaining_spend
            customer.loyalty_points -= points
            if sale.balance_due > 0:
                debt_reversal = min(customer.debt_amount, sale.balance_due)
                customer.debt_amount -= debt_reversal
                customer.debt_updated_at = timezone.now()
                debt_entry = CreditTransaction.objects.select_for_update().filter(
                    customer=customer,
                    sale=sale,
                    type="debt",
                    is_deleted=False,
                ).first()
                if debt_entry:
                    debt_entry.settled_amount = debt_entry.amount
                    debt_entry.save(update_fields=["settled_amount", "updated_at"])
                if customer.debt_amount == 0:
                    customer.debt_started_at = None
                    customer.debt_due_date = None
                CreditTransaction.objects.create(
                    customer=customer,
                    sale=sale,
                    amount=debt_reversal,
                    type="writeoff",
                    reason=f"Credit sale voided: {sale.invoice_number or sale.receipt_number}",
                    idempotency_key=f"sale:{sale.pk}:void-debt",
                )
            previous = customer.sales.filter(is_deleted=False).exclude(pk=sale.pk).order_by("-created_at").first()
            customer.last_visit = previous.created_at if previous else None
            customer.save()
            LoyaltyTransaction.objects.create(customer=customer, points_change=-points, reason=f"Reversed sale {sale.receipt_number}")
        sale.is_deleted = True
        sale.save()
        sale.sale_items.update(is_deleted=True)
        if sale.customer_id:
            from customers.financial_services import refresh_customer_debt_due_date
            refresh_customer_debt_due_date(customer)
        if sale.till_session_id and sale.till_session.status == "closed":
            till = sale.till_session
            TillSessionSerializer(context={"request": self.request}).close(till, till.closing_cash, till.notes)
        log_staff_activity(
            self.request.user, "sale_voided", f"Voided sale {sale.receipt_number}",
            actor=self.request.user, request=self.request, object_type="sale", object_id=sale.id,
            metadata={"before": {
                "total": str(sale.total), "amount_paid_base": str(sale.amount_paid_base),
                "balance_due": str(sale.balance_due), "branch_id": sale.branch_id,
            }, "after": {"is_deleted": True}},
        )

    @action(detail=False, methods=["get"], url_path="aggregations")
    def aggregations(self, request):
        qs = self.get_queryset()
        daily = qs.annotate(day=TruncDay("created_at")).values("day").annotate(total=Sum("total"), gross_profit=Sum("gross_profit")).order_by("-day")[:30]
        weekly = qs.annotate(week=TruncWeek("created_at")).values("week").annotate(total=Sum("total"), gross_profit=Sum("gross_profit")).order_by("-week")[:12]
        monthly = qs.annotate(month=TruncMonth("created_at")).values("month").annotate(total=Sum("total"), gross_profit=Sum("gross_profit")).order_by("-month")[:12]
        return Response({"daily": list(daily), "weekly": list(weekly), "monthly": list(monthly)})

    @action(detail=False, methods=["get"], url_path="profit-summary")
    def profit_summary(self, request):
        qs = self.get_queryset()
        branch = request.query_params.get("branch")
        if branch:
            qs = qs.filter(branch_id=branch)
        totals = qs.aggregate(
            revenue=Sum("total"),
            cost=Sum("total_cost"),
            gross_profit=Sum("gross_profit"),
        )
        revenue = totals["revenue"] or 0
        gross_profit = totals["gross_profit"] or 0
        margin = (gross_profit / revenue * 100) if revenue else 0
        return Response({
            "revenue": revenue,
            "cost": totals["cost"] or 0,
            "gross_profit": gross_profit,
            "margin_percent": margin,
        })

    @action(detail=True, methods=["post"], url_path="returns")
    def create_return(self, request, pk=None):
        if hasattr(request, "api_key"):
            from accounts.authentication import require_area
            require_area(request, "sales")
        sale = self.get_object()
        serializer = SaleReturnSerializer(
            data=request.data,
            context={"request": request, "sale": sale},
        )
        serializer.is_valid(raise_exception=True)
        sale_item = serializer.validated_data["sale_item"]
        quantity = serializer.validated_data["quantity"]
        prior_returns = SaleReturn.objects.filter(sale_item=sale_item, is_deleted=False)
        previous_quantity = prior_returns.aggregate(total=Sum("quantity"))["total"] or 0
        available_quantity = sale_item.quantity - previous_quantity
        previous_refund = prior_returns.aggregate(total=Sum("refund_amount"))["total"] or Decimal("0")
        refund_amount = (
            sale_item.subtotal - previous_refund
            if quantity == available_quantity
            else (sale_item.unit_price - sale_item.discount_amount) * quantity
        )
        require_approval_if_over_threshold(
            request, "refund_amount_base_threshold", refund_amount, "sales.refund"
        )
        sale_return = serializer.save()
        log_staff_activity(
            request.user, "sale_return_recorded", f"Recorded refund for sale {sale.receipt_number}",
            actor=request.user, request=request, object_type="sale_return", object_id=sale_return.id,
            metadata={"sale_id": sale.id, "quantity": sale_return.quantity,
                      "refund_amount": str(sale_return.refund_amount), "refund_method": sale_return.refund_method},
        )
        return Response(SaleReturnSerializer(sale_return).data, status=201)

    @action(detail=True, methods=["get"], url_path="receipt")
    def receipt(self, request, pk=None):
        sale = self.get_object()
        return Response(build_receipt_payload(sale, request.user))

    @action(detail=True, methods=["post"], url_path="whatsapp-receipt")
    def whatsapp_receipt(self, request, pk=None):
        enforce_feature(request.user, "whatsapp_reports")
        sale = self.get_object()
        payload = build_receipt_payload(sale, request.user)
        message = request.data.get("message") or build_receipt_message(payload, request.user.currency_symbol)
        phone = (request.data.get("phone") or payload.get("customer_phone") or "").strip()
        whatsapp_url = f"https://wa.me/{phone}?text={quote(message)}" if phone else f"https://wa.me/?text={quote(message)}"
        log = NotificationLog.objects.create(user=request.user, type="customer_receipt", message=message, channel="whatsapp")
        log_staff_activity(
            request.user,
            "whatsapp_receipt_prepared",
            f"Prepared WhatsApp receipt {sale.receipt_number}",
            actor=request.user,
            request=request,
            object_type="sale",
            object_id=sale.id,
        )
        return Response({
            "message": message,
            "whatsapp_url": whatsapp_url,
            "receipt": payload,
            "log_id": log.id,
        })


class SaleItemViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SaleItemSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["product", "sale"]

    def get_queryset(self):
        queryset = SaleItem.objects.filter(sale__created_by=self.request.user, is_deleted=False)
        return scope_queryset_to_staff_branch(self.request, queryset, "sale__branch_id")


class TillSessionViewSet(viewsets.ModelViewSet):
    serializer_class = TillSessionSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "branch"]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = TillSession.objects.filter(user=self.request.user, is_deleted=False).select_related(
            "branch", "opened_by_staff", "reviewed_by", "reviewed_by_staff"
        ).prefetch_related("cash_movements__expense").order_by("-opened_at")
        return scope_queryset_to_staff_branch(self.request, queryset)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if hasattr(request, "api_key") and request.method in ("POST", "PATCH", "DELETE"):
            from accounts.authentication import require_area
            require_area(request, "sales")

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        session = self.get_queryset().filter(status="open").first()
        return Response({
            "open_till": TillSessionSerializer(session, context={"request": request}).data if session else None,
            "business": {"name": request.user.business_name, "currency": request.user.currency, "currency_symbol": request.user.currency_symbol},
        })

    def partial_update(self, request, *args, **kwargs):
        if hasattr(request, "api_key"):
            from accounts.authentication import require_area
            require_area(request, "sales")
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if hasattr(request, "api_key"):
            from accounts.authentication import require_area
            require_area(request, "sales")
        return super().destroy(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        if hasattr(request, "api_key"):
            from accounts.authentication import require_area
            require_area(request, "sales")
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        with transaction.atomic():
            from django.contrib.auth import get_user_model
            get_user_model().objects.select_for_update().get(pk=self.request.user.pk)
            if TillSession.objects.filter(user=self.request.user, status="open", is_deleted=False).exists():
                from rest_framework.exceptions import ValidationError
                raise ValidationError("Close the current till before opening a new one.")
            serializer.save(user=self.request.user, opened_by_staff=get_staff_member(self.request))

    @action(detail=False, methods=["get"], url_path="current")
    def current(self, request):
        session = self.get_queryset().filter(status="open").first()
        if not session:
            return Response({"detail": "No open till session."}, status=404)
        return Response(TillSessionSerializer(session).data)

    @action(detail=True, methods=["get", "post"], url_path="cash-movements")
    @transaction.atomic
    def cash_movements(self, request, pk=None):
        session = self.get_object()
        if request.method == "GET":
            movements = TillCashMovement.objects.filter(
                user=request.user,
                till_session=session,
                is_deleted=False,
            ).select_related("expense", "created_by")
            return Response(TillCashMovementSerializer(movements, many=True).data)

        session = TillSession.objects.select_for_update().get(pk=session.pk, user=request.user, is_deleted=False)
        if session.status != "open":
            raise ValidationError({"till_session": "Cash movements can only be recorded while the till is open."})

        key = str(request.data.get("idempotency_key", "")).strip()
        if key:
            existing = TillCashMovement.objects.filter(user=request.user, idempotency_key=key).select_related("expense").first()
            if existing:
                try:
                    requested_expense_id = int(request.data.get("expense")) if request.data.get("expense") not in (None, "") else None
                except (TypeError, ValueError):
                    requested_expense_id = None
                same = (
                    existing.till_session_id == session.id
                    and existing.movement_type == request.data.get("movement_type")
                    and existing.expense_id == requested_expense_id
                    and existing.note == str(request.data.get("note", "")).strip()
                )
                if existing.movement_type != TillCashMovement.TYPE_CASH_EXPENSE:
                    try:
                        same = same and existing.amount == Decimal(str(request.data.get("amount", "")))
                    except (TypeError, ValueError, InvalidOperation):
                        same = False
                if same:
                    return Response(TillCashMovementSerializer(existing).data)
                raise ValidationError({"idempotency_key": "This key was already used for a different till movement."})

        movement_payload = TillCashMovementCreateSerializer(
            data=request.data,
            context={"request": request, "session": session},
        )
        movement_payload.is_valid(raise_exception=True)
        values = movement_payload.validated_data
        expense = values.get("expense")
        if expense:
            from expenses.models import Expense
            expense = Expense.objects.select_for_update().get(pk=expense.pk, created_by=request.user, is_deleted=False)
            if TillCashMovement.objects.filter(expense=expense, is_deleted=False).exists():
                raise ValidationError({"expense": "This expense is already linked to a till movement."})
        movement = TillCashMovement.objects.create(
            user=request.user,
            till_session=session,
            created_by=request.user,
            **values,
        )
        log_staff_activity(
            request.user,
            "till_cash_movement_recorded",
            f"Recorded {movement.get_movement_type_display().lower()} of {movement.amount} {request.user.currency}",
            actor=request.user,
            request=request,
            object_type="till_cash_movement",
            object_id=movement.id,
            metadata={"till_session": session.id, "movement_type": movement.movement_type, "expense": movement.expense_id},
        )
        return Response(TillCashMovementSerializer(movement).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="close")
    @transaction.atomic
    def close(self, request, pk=None):
        if hasattr(request, "api_key"):
            from accounts.authentication import require_area
            require_area(request, "sales")
        session = self.get_object()
        session = TillSession.objects.select_for_update().get(
            pk=session.pk, user=request.user, is_deleted=False
        )
        if session.status != "open":
            return Response({"detail": "Till session is already closed."}, status=400)
        close_payload = TillSessionCloseSerializer(data=request.data)
        close_payload.is_valid(raise_exception=True)
        serializer = TillSessionSerializer(session, context={"request": request})
        session = serializer.close(
            session,
            closing_cash=close_payload.validated_data["closing_cash"],
            notes=close_payload.validated_data.get("notes", ""),
        )
        log_staff_activity(
            request.user, "till_session_closed", f"Closed till session {session.pk}",
            actor=request.user, request=request, object_type="till_session", object_id=session.pk,
            metadata={"before": {"status": "open"}, "after": {
                "status": "closed", "opening_cash": str(session.opening_cash),
                "expected_cash": str(session.expected_cash), "closing_cash": str(session.closing_cash),
                "cash_variance": str(session.cash_variance), "notes": session.notes,
            }},
        )
        from reports.automation_engine import queue_automation_event
        queue_automation_event(
            request.user, "till_session_closed", f"till-session:{session.pk}:closed", "till_session", session.pk,
            {"absolute_variance_base": str(abs(session.cash_variance))},
        )
        return Response(TillSessionSerializer(session).data)

    @action(detail=True, methods=["post"], url_path="review")
    @transaction.atomic
    def review(self, request, pk=None):
        if hasattr(request, "api_key"):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("API keys cannot approve till reconciliations.")

        staff = get_staff_member(request)
        require_staff_operation(request, "till.review")

        session = self.get_queryset().select_for_update().get(pk=self.get_object().pk)
        if session.status != "closed":
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"status": "Only closed till sessions can be reviewed."})
        if session.reviewed_at:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"review": "This till session has already been reviewed."})
        if staff and session.opened_by_staff_id == staff.id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("A staff member cannot review their own till session.")

        note = str(request.data.get("note", "")).strip()
        if len(note) > 255:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"note": "Ensure this field has no more than 255 characters."})
        session.reviewed_by = request.user if staff is None else None
        session.reviewed_by_staff = staff
        session.reviewed_at = timezone.now()
        session.review_note = note
        session.save(update_fields=[
            "reviewed_by", "reviewed_by_staff", "reviewed_at", "review_note", "updated_at"
        ])
        from accounts.activity import log_staff_activity
        log_staff_activity(
            request.user,
            "till_session_reviewed",
            f"Reviewed till session {session.pk}",
            actor=request.user,
            request=request,
            object_type="till_session",
            object_id=session.pk,
            metadata={"cash_variance": str(session.cash_variance), "note": note},
        )
        return Response(TillSessionSerializer(session, context={"request": request}).data)
