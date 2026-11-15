from django.db import transaction
from django.db.models import F, Q, Sum
from decimal import Decimal, InvalidOperation
from django.utils import timezone
from rest_framework import serializers
from accounts.branch_access import get_staff_member, require_staff_branch
from accounts.approvals import require_approval_if_over_threshold
from inventory.models import Branch
from expenses.models import Expense
from billing.services import enforce_feature
from customers.models import CreditTransaction, Customer, LoyaltyTransaction
from inventory.models import Product, ProductBatch, StockMovement
from core.currency import normalize_allocations, get_rate_to_base
from .models import Sale, SaleItem, SaleReturn, TillCashMovement, TillSession


class SaleItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleItem
        fields = ["id", "product", "quantity", "unit_price", "discount_amount", "subtotal"]
        extra_kwargs = {"subtotal": {"required": False}}


class SaleItemReadSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    returned_quantity = serializers.SerializerMethodField()

    class Meta:
        model = SaleItem
        fields = ["id", "product", "product_name", "quantity", "unit_cost", "unit_price", "discount_amount", "subtotal", "cost_total", "profit", "returned_quantity"]

    def get_returned_quantity(self, obj):
        active_returns = getattr(obj, "active_returns", None)
        if active_returns is not None:
            return sum(item.quantity for item in active_returns)
        return obj.returns.filter(is_deleted=False).aggregate(total=Sum("quantity"))["total"] or 0


class SaleReturnSerializer(serializers.ModelSerializer):
    payment_allocations = serializers.JSONField(required=False)

    class Meta:
        model = SaleReturn
        fields = ["id", "sale_item", "quantity", "refund_amount", "cost_amount", "refund_method", "return_date", "payment_allocations"]
        read_only_fields = ["refund_amount", "cost_amount", "return_date"]

    def validate_sale_item(self, sale_item):
        sale = self.context["sale"]
        if sale_item.sale_id != sale.id or sale_item.is_deleted:
            raise serializers.ValidationError("Choose an item from this sale.")
        return sale_item

    def validate_quantity(self, quantity):
        if quantity <= 0:
            raise serializers.ValidationError("Return quantity must be greater than zero.")
        return quantity

    @transaction.atomic
    def create(self, validated_data):
        sale = self.context["sale"]
        user = self.context["request"].user
        sale_item = SaleItem.objects.select_for_update().get(
            pk=validated_data["sale_item"].pk,
            sale=sale,
            is_deleted=False,
        )
        previous_returns = SaleReturn.objects.filter(sale_item=sale_item, is_deleted=False)
        previous_quantity = previous_returns.aggregate(total=Sum("quantity"))["total"] or 0
        available_quantity = sale_item.quantity - previous_quantity
        quantity = validated_data["quantity"]
        if quantity > available_quantity:
            raise serializers.ValidationError({"quantity": f"Only {available_quantity} item(s) remain eligible for return."})

        previous_totals = previous_returns.aggregate(
            refund=Sum("refund_amount"),
            cost=Sum("cost_amount"),
        )
        refund_amount = (
            sale_item.subtotal - (previous_totals["refund"] or Decimal("0"))
            if quantity == available_quantity
            else (sale_item.unit_price - sale_item.discount_amount) * quantity
        )
        cost_amount = (
            sale_item.cost_total - (previous_totals["cost"] or Decimal("0"))
            if quantity == available_quantity
            else (sale_item.unit_cost * quantity).quantize(Decimal("0.01"))
        )
        submitted_allocations = validated_data.pop("payment_allocations", [])
        if validated_data.get("refund_method", "Cash") == "Credit" and any(row.get("account") for row in submitted_allocations):
            raise serializers.ValidationError({"payment_allocations": "Store credit cannot be posted as a cash refund."})
        allocations, allocations_total = normalize_allocations(
            user,
            submitted_allocations,
            refund_amount,
            user.currency,
            Decimal("1"),
            field_name="payment_allocations",
        )
        if allocations_total != refund_amount:
            raise serializers.ValidationError({"payment_allocations": "Refund allocations must add up to the refund amount in the business currency."})
        sale_return = SaleReturn.objects.create(
            **validated_data,
            refund_amount=refund_amount,
            cost_amount=cost_amount,
            payment_allocations=allocations,
            created_by=user,
        )

        if sale_return.refund_method != "Credit" and allocations:
            from reports.financial_services import post_allocations_to_accounts

            post_allocations_to_accounts(
                user=user,
                allocations=allocations,
                direction="out",
                entry_type="sale_refund",
                transaction_date=sale_return.return_date,
                description=f"Sale refund {sale.receipt_number}",
                source_key=f"sale-return:{sale_return.pk}:refund",
                created_by=user,
                reference=sale.invoice_number or sale.receipt_number,
            )

        if sale.customer_id:
            customer = Customer.objects.select_for_update().get(pk=sale.customer_id)
            prior_refunds = previous_totals["refund"] or Decimal("0")
            points_before = int(max(sale.total - prior_refunds, Decimal("0")) // 10)
            points_after = int(max(sale.total - prior_refunds - refund_amount, Decimal("0")) // 10)
            points_change = points_after - points_before
            customer.total_spent -= refund_amount
            customer.loyalty_points += points_change
            debt_reduction = min(sale.balance_due, refund_amount) if sale_return.refund_method == "Credit" else Decimal("0")
            if debt_reduction:
                sale.balance_due -= debt_reduction
                customer.debt_amount = max(customer.debt_amount - debt_reduction, Decimal("0"))
                customer.debt_updated_at = timezone.now()
                sale.save(update_fields=["balance_due", "updated_at"])
                if customer.debt_amount == 0:
                    customer.debt_started_at = None
                    customer.debt_due_date = None
                CreditTransaction.objects.create(
                    customer=customer,
                    amount=debt_reduction,
                    type="writeoff",
                    reason=f"Credit applied for return on {sale.invoice_number or sale.receipt_number}",
                    idempotency_key=f"return:{sale_return.pk}:credit",
                )
            customer.save()
            if points_change:
                LoyaltyTransaction.objects.create(
                    customer=customer,
                    points_change=points_change,
                    reason=f"Returned items from {sale.receipt_number}",
                )

        product = Product.objects.select_for_update().get(pk=sale_item.product_id)
        product.stock += quantity
        product.save(update_fields=["stock", "status", "updated_at"])
        batch = ProductBatch.objects.create(
            product=product,
            batch_number=f"return-{sale_return.pk}",
            quantity_received=quantity,
            quantity_remaining=quantity,
            unit_cost_base=sale_item.unit_cost,
        )
        StockMovement.objects.create(
            product=product,
            batch=batch,
            quantity=quantity,
            movement_type="in",
            created_by=user,
            reason=f"Return for {sale.receipt_number}",
        )
        return sale_return


class SaleSerializer(serializers.ModelSerializer):
    sale_items = SaleItemSerializer(many=True, required=False)
    items = serializers.ListField(child=serializers.DictField(), required=False, write_only=True)
    line_items = SaleItemReadSerializer(source="sale_items", many=True, read_only=True)
    payment_currency = serializers.CharField(required=False)
    payment_allocations = serializers.JSONField(required=False)
    integration_id = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = Sale
        fields = [
            "id",
            "items",
            "total",
            "total_cost",
            "gross_profit",
            "payment_method",
            "payment_currency",
            "payment_allocations",
            "amount_paid_base",
            "balance_due",
            "due_date",
            "integration_id",
            "branch",
            "till_session",
            "receipt_number",
            "invoice_number",
            "customer",
            "created_by",
            "date",
            "time",
            "created_at",
            "updated_at",
            "sale_items",
            "line_items",
        ]
        read_only_fields = ["created_by", "date", "time", "created_at", "updated_at", "total", "total_cost", "gross_profit", "amount_paid_base", "balance_due", "receipt_number", "invoice_number"]

        extra_kwargs = {"sale_items": {"write_only": True}}

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        branch = attrs.get("branch")
        sale_items = attrs.get("sale_items")
        api_items = attrs.get("items")
        if sale_items is not None and api_items is not None:
            raise serializers.ValidationError({"items": "Provide either items or sale_items, not both."})
        items = sale_items if sale_items is not None else (api_items or [])
        payment_currency = (attrs.get("payment_currency") or getattr(self.instance, "payment_currency", getattr(user, "currency", "ZAR"))).strip().upper()
        attrs["payment_currency"] = payment_currency
        if user and user.is_authenticated:
            if branch and branch.user_id != user.id:
                raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
            till_session = attrs.get("till_session")
            if till_session and (till_session.is_deleted or till_session.status != "open"):
                raise serializers.ValidationError({"till_session": "Till session must be open."})
            if till_session and till_session.user_id != user.id:
                raise serializers.ValidationError({"till_session": "Till session does not belong to this account."})
            if till_session and not branch:
                branch = till_session.branch
                attrs["branch"] = branch
            staff = get_staff_member(request)
            if staff:
                if not staff.branch_id:
                    raise serializers.ValidationError({"branch": "This staff account must be assigned to a branch."})
                if branch is None:
                    branch = Branch.objects.get(pk=staff.branch_id, user=user, is_deleted=False)
                    attrs["branch"] = branch
                require_staff_branch(request, branch.id)
                if till_session and till_session.branch_id != staff.branch_id:
                    raise serializers.ValidationError({"till_session": "Till session belongs to another branch."})
            if branch:
                enforce_feature(user, "multi_branch")
            if till_session and branch and till_session.branch_id and till_session.branch_id != branch.id:
                raise serializers.ValidationError({"till_session": "Till session belongs to another branch."})
            customer = attrs.get("customer")
            if customer and customer.user_id != user.id:
                raise serializers.ValidationError({"customer": "Customer does not belong to this account."})
            if customer and customer.branch_id and branch is None:
                branch = customer.branch
                attrs["branch"] = branch
                require_staff_branch(request, branch.id)
            if customer and customer.branch_id and branch and customer.branch_id != branch.id:
                raise serializers.ValidationError({"customer": "Customer belongs to a different branch."})
            normalized_items = []
            for item in items:
                product = item.get("product")
                if not hasattr(product, "user_id"):
                    product_id = product
                    try:
                        product = Product.objects.get(pk=product_id, user=user, is_deleted=False)
                    except (Product.DoesNotExist, ValueError, TypeError):
                        raise serializers.ValidationError({"items": f"Product {product_id} was not found."})
                    item["product"] = product
                try:
                    quantity_value = Decimal(str(item.get("quantity", 0)))
                    if not quantity_value.is_finite() or quantity_value != quantity_value.to_integral_value():
                        raise ValueError("Quantity must be a whole number.")
                    quantity = int(quantity_value)
                    unit_price = Decimal(str(item.get("unit_price", 0)))
                    discount_amount = Decimal(str(item.get("discount_amount", 0)))
                except (TypeError, ValueError, InvalidOperation):
                    raise serializers.ValidationError({"items": "Each item needs a valid quantity and unit_price."})
                if quantity <= 0:
                    raise serializers.ValidationError({"sale_items": "Quantities must be greater than zero."})
                if unit_price < 0:
                    raise serializers.ValidationError({"sale_items": "Selling prices cannot be negative."})
                if discount_amount < 0 or discount_amount > unit_price:
                    raise serializers.ValidationError({"sale_items": "Discounts must be between zero and the unit price."})
                if unit_price.as_tuple().exponent < -2:
                    raise serializers.ValidationError({"sale_items": "Selling prices can have at most two decimal places."})
                if discount_amount.as_tuple().exponent < -2:
                    raise serializers.ValidationError({"sale_items": "Discounts can have at most two decimal places."})
                item["quantity"] = quantity
                item["unit_price"] = unit_price
                item["discount_amount"] = discount_amount
                if product and product.is_deleted:
                    raise serializers.ValidationError({"sale_items": "Product has been deleted."})
                if product and product.branch_id and not branch:
                    raise serializers.ValidationError({"branch": f"Choose a branch for {product.name}."})
                if branch and product and product.branch_id and product.branch_id != branch.id:
                    raise serializers.ValidationError({"sale_items": f"{product.name} belongs to another branch."})
                if staff and product and product.branch_id != staff.branch_id:
                    raise serializers.ValidationError({"sale_items": f"{product.name} is not assigned to your authorised branch."})
                normalized_items.append({**item, "product": product, "quantity": quantity, "unit_price": unit_price, "discount_amount": discount_amount})
            if items and "sale_items" not in attrs:
                attrs["sale_items"] = normalized_items
            elif items:
                attrs["sale_items"] = normalized_items
            gross_total = sum(
                (item["unit_price"] * item["quantity"] for item in normalized_items),
                Decimal("0"),
            )
            discount_total = sum(
                (item["discount_amount"] * item["quantity"] for item in normalized_items),
                Decimal("0"),
            )
            if gross_total > 0 and discount_total > 0:
                discount_percent = (discount_total / gross_total * Decimal("100")).quantize(Decimal("0.01"))
                require_approval_if_over_threshold(
                    request, "discount_percent_threshold", discount_percent, "sales.discount_approve"
                )
        return attrs

    def validate_integration_id(self, value):
        value = (value or "").strip()
        if len(value) > 120:
            raise serializers.ValidationError("Ensure this field has no more than 120 characters.")
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["items"] = data.pop("line_items", [])
        data.pop("sale_items", None)
        return data

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("sale_items", [])
        validated_data.pop("items", None)
        payment_currency = validated_data.pop("payment_currency", "")
        submitted_allocations = validated_data.pop("payment_allocations", [])
        if not items:
            raise serializers.ValidationError({"sale_items": "Add at least one sale item."})
        customer = validated_data.get("customer")
        branch = validated_data.get("branch")
        if customer:
            customer = Customer.objects.select_for_update().get(pk=customer.pk, user=customer.user)
            if customer.branch_id and customer.branch_id != branch.id:
                raise serializers.ValidationError({"customer": "Customer belongs to a different branch."})
            if not customer.branch_id:
                customer.branch = branch
                customer.save(update_fields=["branch", "updated_at"])
            validated_data["customer"] = customer
        sale = Sale.objects.create(**validated_data)
        total = 0
        total_cost = 0
        item_labels = []
        # Lock rows in stable order to prevent overselling and deadlocks when a
        # receipt contains more than one product (including duplicate lines).
        product_ids = sorted({item["product"].pk for item in items})
        locked_products = {
            product.pk: product
            for product in Product.objects.select_for_update().filter(pk__in=product_ids).order_by("pk")
        }
        requested = {}
        for item in items:
            requested[item["product"].pk] = requested.get(item["product"].pk, 0) + item["quantity"]
        for product_id, quantity in requested.items():
            product = locked_products.get(product_id)
            if not product or product.user_id != sale.created_by_id or product.is_deleted:
                raise serializers.ValidationError({"sale_items": "A product is no longer available."})
            batch_totals = ProductBatch.objects.filter(product=product, is_deleted=False).aggregate(
                remaining=Sum("quantity_remaining"),
                sellable=Sum(
                    "quantity_remaining",
                    filter=Q(expiry_date__isnull=True) | Q(expiry_date__gte=timezone.localdate()),
                ),
            )
            tracked_quantity = batch_totals["remaining"] or 0
            legacy_quantity = max(product.stock - tracked_quantity, 0)
            sellable_quantity = (batch_totals["sellable"] or 0) + legacy_quantity
            if product.stock < quantity or sellable_quantity < quantity:
                raise serializers.ValidationError({"sale_items": f"Insufficient stock for {product.name}."})

        for item in items:
            product = locked_products[item["product"].pk]
            qty = item["quantity"]
            unit_price = item["unit_price"]
            discount_amount = item.get("discount_amount", Decimal("0"))
            subtotal = (unit_price - discount_amount) * qty
            remaining_to_allocate = qty
            batch_allocations = []
            cost_total = Decimal("0")
            batches = ProductBatch.objects.select_for_update().filter(
                product=product,
                is_deleted=False,
                quantity_remaining__gt=0,
            ).filter(
                Q(expiry_date__isnull=True) | Q(expiry_date__gte=timezone.localdate())
            ).order_by(F("expiry_date").asc(nulls_last=True), "received_at", "id")
            for batch in batches:
                allocated = min(remaining_to_allocate, batch.quantity_remaining)
                if allocated <= 0:
                    continue
                batch_allocations.append((batch, allocated))
                batch_cost = batch.unit_cost_base if batch.unit_cost_base > 0 else product.cost_price
                cost_total += batch_cost * allocated
                batch.quantity_remaining -= allocated
                batch.save(update_fields=["quantity_remaining", "updated_at"])
                remaining_to_allocate -= allocated
                if remaining_to_allocate == 0:
                    break
            cost_total += product.cost_price * remaining_to_allocate
            unit_cost = (cost_total / qty).quantize(Decimal("0.01"))
            profit = subtotal - cost_total
            SaleItem.objects.create(
                sale=sale,
                product=product,
                quantity=qty,
                unit_cost=unit_cost,
                unit_price=unit_price,
                discount_amount=discount_amount,
                subtotal=subtotal,
                cost_total=cost_total,
                profit=profit,
            )
            for batch, allocated in batch_allocations:
                StockMovement.objects.create(
                    product=product,
                    batch=batch,
                    quantity=allocated,
                    movement_type="out",
                    created_by=sale.created_by,
                    reason=sale.receipt_number,
                )
            if remaining_to_allocate:
                StockMovement.objects.create(
                    product=product,
                    quantity=remaining_to_allocate,
                    movement_type="out",
                    created_by=sale.created_by,
                    reason=sale.receipt_number,
                )
            total += subtotal
            total_cost += cost_total
            item_labels.append(f"{qty}x {product.name}")

        for product_id, quantity in requested.items():
            product = locked_products[product_id]
            product.stock -= quantity
            product.save(update_fields=["stock", "status", "updated_at"])
        
        sale.total = total
        sale.total_cost = total_cost
        sale.gross_profit = total - total_cost
        sale.items = ", ".join(item_labels) if item_labels else ""
        if sale.payment_method == "Credit" and not submitted_allocations:
            allocations, allocations_total = [], Decimal("0.00")
        else:
            rate = get_rate_to_base(sale.created_by, payment_currency or sale.created_by.currency) if not submitted_allocations else Decimal("1")
            allocations, allocations_total = normalize_allocations(
                sale.created_by,
                submitted_allocations,
                (Decimal(total) / rate).quantize(Decimal("0.01")),
                payment_currency or sale.created_by.currency,
                rate,
                field_name="payment_allocations",
            )
        total_amount = Decimal(str(total)).quantize(Decimal("0.01"))
        if allocations_total > total_amount:
            raise serializers.ValidationError({
                "payment_allocations": "Payments cannot exceed the sale total."
            })
        balance_due = (total_amount - allocations_total).quantize(Decimal("0.01"))
        if balance_due > 0 and not customer:
            raise serializers.ValidationError({"customer": "Select a customer before recording a credit sale."})
        if balance_due > 0:
            enforce_feature(sale.created_by, "customer_credit")
        if customer and balance_due > 0 and customer.credit_limit is not None:
            if customer.debt_amount + balance_due > customer.credit_limit:
                raise serializers.ValidationError({
                    "customer": f"This sale exceeds the customer's available credit limit of {customer.credit_limit - customer.debt_amount:.2f}."
                })
        sale.payment_allocations = allocations
        sale.amount_paid_base = allocations_total
        sale.balance_due = balance_due
        sale.payment_currency = allocations[0]["currency"] if len(allocations) == 1 else ("MIXED" if allocations else payment_currency)
        sale.save()
        
        customer = Customer.objects.select_for_update().get(pk=sale.customer_id) if sale.customer_id else None
        if customer:
            if balance_due > 0:
                now = timezone.now()
                if customer.debt_amount <= 0:
                    customer.debt_started_at = now
                customer.debt_amount += balance_due
                customer.debt_updated_at = now
                CreditTransaction.objects.create(
                    customer=customer,
                    sale=sale,
                    amount=balance_due,
                    type="debt",
                    due_date=sale.due_date,
                    reason=f"Credit sale {sale.invoice_number or sale.receipt_number}",
                    idempotency_key=f"sale:{sale.pk}:debt",
                )
            customer.last_visit = timezone.now()
            customer.visits += 1
            customer.total_spent += total
            points = int(total // 10)
            customer.loyalty_points += points
            customer.save()
            if balance_due > 0:
                from customers.financial_services import refresh_customer_debt_due_date
                refresh_customer_debt_due_date(customer)
            LoyaltyTransaction.objects.create(customer=customer, points_change=points, reason="Sale purchase")

        if sale.payment_allocations:
            from reports.financial_services import post_allocations_to_accounts

            post_allocations_to_accounts(
                user=sale.created_by,
                allocations=sale.payment_allocations,
                direction="in",
                entry_type="sale_receipt",
                transaction_date=sale.date,
                description=f"Sale receipt {sale.receipt_number}",
                source_key=f"sale:{sale.pk}:payment",
                created_by=sale.created_by,
                reference=sale.invoice_number or sale.receipt_number,
            )
        
        from accounts.webhooks import enqueue_webhook_event
        enqueue_webhook_event(sale.created_by, "sale.created", {
            "sale_id": sale.id,
            "total": str(sale.total),
            "payment_method": sale.payment_method,
            "payment_currency": sale.payment_currency,
            "created_at": sale.created_at.isoformat(),
        })
        return sale


class TillCashMovementCreateSerializer(serializers.Serializer):
    movement_type = serializers.ChoiceField(choices=TillCashMovement.TYPE_CHOICES)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"), required=False)
    expense = serializers.PrimaryKeyRelatedField(
        queryset=Expense.objects.filter(is_deleted=False),
        required=False,
        allow_null=True,
    )
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
    idempotency_key = serializers.CharField(max_length=120)

    def validate(self, attrs):
        request = self.context["request"]
        session = self.context["session"]
        movement_type = attrs["movement_type"]
        expense = attrs.get("expense")
        amount = attrs.get("amount")
        key = attrs.get("idempotency_key", "").strip()
        if not key:
            raise serializers.ValidationError({"idempotency_key": "A unique operation key is required."})
        attrs["idempotency_key"] = key

        if movement_type == TillCashMovement.TYPE_CASH_EXPENSE:
            if not expense:
                raise serializers.ValidationError({"expense": "Choose the recorded expense paid from this till."})
            if expense.created_by_id != request.user.id or expense.is_deleted:
                raise serializers.ValidationError({"expense": "Expense does not belong to this business."})
            if expense.approval_status == "rejected":
                raise serializers.ValidationError({"expense": "A rejected expense cannot be linked to a till."})
            if expense.branch_id != session.branch_id:
                raise serializers.ValidationError({"expense": "Expense and till must belong to the same branch."})
            for allocation in expense.payment_allocations or []:
                account_id = allocation.get("account")
                if not account_id:
                    continue
                from reports.models import BankAccount
                account = BankAccount.objects.filter(
                    pk=account_id,
                    user=request.user,
                    is_deleted=False,
                ).first()
                if account is None or account.account_type != "cash":
                    raise serializers.ValidationError({"expense": "Only a cash-paid expense can be assigned to a till."})
            duplicate = TillCashMovement.objects.filter(expense=expense, is_deleted=False).first()
            existing_key = TillCashMovement.objects.filter(user=request.user, idempotency_key=key).first()
            if duplicate and duplicate.id != getattr(existing_key, "id", None):
                raise serializers.ValidationError({"expense": "This expense is already linked to a till movement."})
            attrs["amount"] = expense.amount_base
        else:
            if expense:
                raise serializers.ValidationError({"expense": "Only a cash expense movement can link an expense."})
            if amount is None:
                raise serializers.ValidationError({"amount": "Enter the amount of cash moved."})
        return attrs


class TillCashMovementSerializer(serializers.ModelSerializer):
    expense_description = serializers.CharField(source="expense.description", read_only=True, allow_null=True)

    class Meta:
        model = TillCashMovement
        fields = ["id", "movement_type", "amount", "expense", "expense_description", "note", "idempotency_key", "created_at", "created_by"]
        read_only_fields = fields


class TillSessionSerializer(serializers.ModelSerializer):
    sales_total = serializers.SerializerMethodField()
    cash_sales = serializers.SerializerMethodField()
    cash_expenses = serializers.SerializerMethodField()
    cash_withdrawals = serializers.SerializerMethodField()
    cash_deposits = serializers.SerializerMethodField()
    cash_movements = serializers.SerializerMethodField()
    expected_cash = serializers.SerializerMethodField()
    card_sales_total = serializers.SerializerMethodField()
    eft_sales_total = serializers.SerializerMethodField()
    reviewer_name = serializers.SerializerMethodField()

    class Meta:
        model = TillSession
        fields = "__all__"
        read_only_fields = [
            "user", "opened_by_staff", "status", "closing_cash", "expected_cash", "cash_variance",
            "card_total", "eft_total", "opened_at", "closed_at", "created_at", "updated_at",
            "reviewed_by", "reviewed_by_staff", "reviewed_at", "review_note",
        ]

    def get_fields(self):
        fields = super().get_fields()
        if self.instance:
            for name in ("opening_cash", "branch", "cashier_name", "notes"):
                fields[name].read_only = True
        return fields

    def _movement_summary(self, obj):
        cached = getattr(obj, "_cash_movement_summary", None)
        if cached is not None:
            return cached
        movements = [row for row in obj.cash_movements.all() if not row.is_deleted]
        summary = {TillCashMovement.TYPE_CASH_EXPENSE: Decimal("0.00"), TillCashMovement.TYPE_WITHDRAWAL: Decimal("0.00"), TillCashMovement.TYPE_DEPOSIT: Decimal("0.00")}
        for movement in movements:
            summary[movement.movement_type] = summary.get(movement.movement_type, Decimal("0.00")) + movement.amount
        obj._cash_movement_summary = summary
        obj._active_cash_movements = movements
        return summary

    def get_cash_expenses(self, obj):
        return self._movement_summary(obj)[TillCashMovement.TYPE_CASH_EXPENSE]

    def get_cash_withdrawals(self, obj):
        return self._movement_summary(obj)[TillCashMovement.TYPE_WITHDRAWAL]

    def get_cash_deposits(self, obj):
        return self._movement_summary(obj)[TillCashMovement.TYPE_DEPOSIT]

    def get_cash_movements(self, obj):
        self._movement_summary(obj)
        return TillCashMovementSerializer(obj._active_cash_movements, many=True).data

    def get_expected_cash(self, obj):
        if obj.status == "closed":
            return obj.expected_cash
        movement_summary = self._movement_summary(obj)
        return (
            obj.opening_cash
            + self.get_cash_sales(obj)
            - movement_summary[TillCashMovement.TYPE_CASH_EXPENSE]
            - movement_summary[TillCashMovement.TYPE_WITHDRAWAL]
            + movement_summary[TillCashMovement.TYPE_DEPOSIT]
        )

    def validate_opening_cash(self, value):
        if value < Decimal("0.00"):
            raise serializers.ValidationError("Opening cash cannot be negative.")
        return value

    def validate_cashier_name(self, value):
        return value.strip()

    def get_sales_total(self, obj):
        return sum(sale.total for sale in obj.sales.filter(is_deleted=False))

    def get_cash_sales(self, obj):
        sales_total = obj.sales.filter(is_deleted=False, payment_method="Cash").aggregate(
            total=Sum("amount_paid_base")
        )["total"] or Decimal("0.00")
        cash_refunds = SaleReturn.objects.filter(
            sale_item__sale__till_session=obj,
            refund_method="Cash",
            is_deleted=False,
        ).aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")
        return sales_total - cash_refunds

    def get_card_sales_total(self, obj):
        collected = obj.sales.filter(is_deleted=False, payment_method="Card").aggregate(
            total=Sum("amount_paid_base")
        )["total"] or Decimal("0.00")
        refunds = SaleReturn.objects.filter(
            sale_item__sale__till_session=obj,
            refund_method="Card",
            is_deleted=False,
        ).aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")
        return collected - refunds

    def get_eft_sales_total(self, obj):
        collected = obj.sales.filter(is_deleted=False, payment_method="EFT").aggregate(
            total=Sum("amount_paid_base")
        )["total"] or Decimal("0.00")
        refunds = SaleReturn.objects.filter(
            sale_item__sale__till_session=obj,
            refund_method="EFT",
            is_deleted=False,
        ).aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")
        return collected - refunds

    def get_reviewer_name(self, obj):
        if obj.reviewed_by_staff_id:
            return obj.reviewed_by_staff.name
        return obj.reviewed_by.email if obj.reviewed_by_id else None

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        branch = attrs.get("branch")
        staff = get_staff_member(request)
        if staff:
            if not staff.branch_id:
                raise serializers.ValidationError({"branch": "This staff account must be assigned to a branch."})
            if branch is None:
                branch = self.instance.branch if self.instance else None
            if branch is None:
                branch = Branch.objects.get(pk=staff.branch_id, user=user, is_deleted=False)
                attrs["branch"] = branch
            require_staff_branch(request, branch.id)
        if user and user.is_authenticated and branch:
            if branch.user_id != user.id:
                raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
            enforce_feature(user, "multi_branch")
        return attrs

    def close(self, instance, closing_cash, notes=""):
        closing_cash = Decimal(str(closing_cash or 0))
        sales = instance.sales.filter(is_deleted=False)
        instance.closing_cash = closing_cash
        instance.expected_cash = self.get_expected_cash(instance)
        instance.cash_variance = closing_cash - instance.expected_cash
        instance.card_total = sales.filter(payment_method="Card").aggregate(
            total=Sum("amount_paid_base")
        )["total"] or Decimal("0.00")
        instance.eft_total = sales.filter(payment_method="EFT").aggregate(
            total=Sum("amount_paid_base")
        )["total"] or Decimal("0.00")
        card_refunds = SaleReturn.objects.filter(
            sale_item__sale__till_session=instance,
            refund_method="Card",
            is_deleted=False,
        ).aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")
        eft_refunds = SaleReturn.objects.filter(
            sale_item__sale__till_session=instance,
            refund_method="EFT",
            is_deleted=False,
        ).aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")
        instance.card_total -= card_refunds
        instance.eft_total -= eft_refunds
        instance.notes = notes
        instance.status = "closed"
        instance.closed_at = timezone.now()
        instance.save()
        return instance


class TillSessionCloseSerializer(serializers.Serializer):
    closing_cash = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.00"))
    notes = serializers.CharField(required=False, allow_blank=True)
