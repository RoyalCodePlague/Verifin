from django.conf import settings
from django.db import models
from django.utils import timezone
from core.models import TimeStampedSoftDeleteModel


class Category(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="categories")
    name = models.CharField(max_length=100)

    class Meta:
        unique_together = ("user", "name")


class Branch(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="branches")
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=30, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    opening_date = models.DateField(default=timezone.localdate)
    manager = models.ForeignKey(
        "accounts.Staff",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="managed_branches",
    )
    is_primary = models.BooleanField(default=False)

    class Meta:
        unique_together = ("user", "name")

    def save(self, *args, **kwargs):
        if self.is_primary:
            Branch.objects.filter(user=self.user, is_primary=True).exclude(pk=self.pk).update(is_primary=False)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Supplier(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="suppliers")
    name = models.CharField(max_length=160)
    contact_name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    invoice_email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    tax_number = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    lead_time_days = models.PositiveIntegerField(default=7)
    payment_terms_days = models.PositiveIntegerField(default=14)
    reliability_score = models.PositiveSmallIntegerField(default=80)
    minimum_order_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        unique_together = ("user", "name")

    def __str__(self):
        return self.name


class BarcodeLookupCache(TimeStampedSoftDeleteModel):
    barcode = models.CharField(max_length=100, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    brand = models.CharField(max_length=255, blank=True)
    category = models.CharField(max_length=120, blank=True)
    source = models.CharField(max_length=50, default="cache")

    def __str__(self):
        return f"{self.barcode} - {self.name}"


class Product(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [("ok", "ok"), ("low", "low"), ("out", "out")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="products")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True, related_name="products")
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=100)
    barcode = models.CharField(max_length=100, blank=True)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, blank=True, null=True, related_name="products")
    preferred_supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, blank=True, null=True, related_name="products")
    stock = models.IntegerField(default=0)
    reorder_level = models.IntegerField(default=0)
    cost_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cost_currency = models.CharField(max_length=10, default="ZAR")
    cost_fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="ok")

    class Meta:
        unique_together = ("user", "branch", "sku")

    def save(self, *args, **kwargs):
        if self.stock <= 0:
            self.status = "out"
        elif self.stock <= self.reorder_level:
            self.status = "low"
        else:
            self.status = "ok"
        super().save(*args, **kwargs)


class ProductBatch(TimeStampedSoftDeleteModel):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="batches")
    batch_number = models.CharField(max_length=100)
    expiry_date = models.DateField(blank=True, null=True, db_index=True)
    quantity_received = models.PositiveIntegerField()
    quantity_remaining = models.PositiveIntegerField()
    unit_cost_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, blank=True, null=True, related_name="product_batches")
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "batch_number"], name="unique_product_batch_number"),
        ]
        indexes = [models.Index(fields=["product", "expiry_date"])]


class StockMovement(TimeStampedSoftDeleteModel):
    MOVEMENT_CHOICES = [("in", "in"), ("out", "out"), ("adjustment", "adjustment")]
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="movements")
    batch = models.ForeignKey(ProductBatch, on_delete=models.SET_NULL, blank=True, null=True, related_name="movements")
    quantity = models.IntegerField()
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_CHOICES)
    reason = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stock_movements")


class StockTransfer(TimeStampedSoftDeleteModel):
    STATUS_REQUESTED = "requested"
    STATUS_APPROVED = "approved"
    STATUS_DISPATCHED = "dispatched"
    STATUS_PARTIALLY_RECEIVED = "partially_received"
    STATUS_COMPLETED = "completed"
    STATUS_REJECTED = "rejected"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_REQUESTED, "Requested"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_DISPATCHED, "Dispatched"),
        (STATUS_PARTIALLY_RECEIVED, "Partially received"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_CANCELLED, "Cancelled"),
    ]
    from_branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="outgoing_transfers")
    to_branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="incoming_transfers")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="transfers")
    target_product = models.ForeignKey(
        Product, on_delete=models.SET_NULL, blank=True, null=True, related_name="incoming_transfers"
    )
    batch = models.ForeignKey(
        ProductBatch, on_delete=models.SET_NULL, blank=True, null=True, related_name="transfers"
    )
    quantity = models.PositiveIntegerField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stock_transfers")
    note = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_REQUESTED)
    quantity_dispatched = models.PositiveIntegerField(default=0)
    quantity_received = models.PositiveIntegerField(default=0)
    quantity_discrepant = models.PositiveIntegerField(default=0)
    idempotency_key = models.CharField(max_length=120, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="approved_stock_transfers",
    )
    dispatched_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="dispatched_stock_transfers",
    )
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="received_stock_transfers",
    )
    approved_at = models.DateTimeField(blank=True, null=True)
    dispatched_at = models.DateTimeField(blank=True, null=True)
    received_at = models.DateTimeField(blank=True, null=True)
    discrepancy_note = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="stock_transfer_quantity_positive"),
            models.CheckConstraint(
                condition=models.Q(quantity_dispatched__lte=models.F("quantity")),
                name="stock_transfer_dispatched_lte_requested",
            ),
            models.CheckConstraint(
                condition=models.Q(quantity_received__lte=models.F("quantity_dispatched")),
                name="stock_transfer_received_lte_dispatched",
            ),
            models.CheckConstraint(
                condition=models.Q(quantity_discrepant__lte=models.F("quantity_dispatched") - models.F("quantity_received")),
                name="stock_transfer_discrepant_lte_unreceived",
            ),
            models.UniqueConstraint(
                fields=["created_by", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_stock_transfer_key_per_user",
            ),
        ]

    @property
    def quantity_in_transit(self):
        return self.quantity_dispatched - self.quantity_received - self.quantity_discrepant


class StockTransferEvent(models.Model):
    ACTION_CHOICES = [
        ("requested", "Requested"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("cancelled", "Cancelled"),
        ("dispatched", "Dispatched"),
        ("received", "Received"),
    ]
    transfer = models.ForeignKey(StockTransfer, on_delete=models.PROTECT, related_name="events")
    action = models.CharField(max_length=16, choices=ACTION_CHOICES)
    quantity = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stock_transfer_events")
    created_at = models.DateTimeField(auto_now_add=True)


class PurchaseOrder(TimeStampedSoftDeleteModel):
    STATUS_DRAFT = "draft"
    STATUS_SUBMITTED = "submitted"
    STATUS_APPROVED = "approved"
    STATUS_PARTIALLY_RECEIVED = "partially_received"
    STATUS_FULLY_RECEIVED = "fully_received"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_DRAFT, STATUS_DRAFT),
        (STATUS_SUBMITTED, STATUS_SUBMITTED),
        (STATUS_APPROVED, STATUS_APPROVED),
        (STATUS_PARTIALLY_RECEIVED, STATUS_PARTIALLY_RECEIVED),
        (STATUS_FULLY_RECEIVED, STATUS_FULLY_RECEIVED),
        (STATUS_COMPLETED, STATUS_COMPLETED),
        (STATUS_CANCELLED, STATUS_CANCELLED),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="purchase_orders")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchase_orders")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True, related_name="purchase_orders")
    order_number = models.CharField(max_length=40)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="draft")
    currency = models.CharField(max_length=10, default="ZAR")
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    expected_date = models.DateField(blank=True, null=True)
    supplier_invoice_number = models.CharField(max_length=80, blank=True)
    invoice_date = models.DateField(blank=True, null=True)
    due_date = models.DateField(blank=True, null=True)
    notes = models.TextField(blank=True)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    additional_charges = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_cost_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    submitted_at = models.DateTimeField(blank=True, null=True)
    approved_at = models.DateTimeField(blank=True, null=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, blank=True, null=True, related_name="approved_purchase_orders"
    )
    completed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        unique_together = ("user", "order_number")

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.order_number:
            self.order_number = f"PO-{self.pk:05d}"
            PurchaseOrder.objects.filter(pk=self.pk).update(order_number=self.order_number)


class PurchaseOrderItem(TimeStampedSoftDeleteModel):
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="purchase_order_items")
    quantity_ordered = models.PositiveIntegerField(default=1)
    quantity_received = models.PositiveIntegerField(default=0)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit_cost_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)


class PurchaseOrderEvent(models.Model):
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="events")
    from_status = models.CharField(max_length=30, blank=True)
    to_status = models.CharField(max_length=30)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="purchase_order_events")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class GoodsReceivedNote(TimeStampedSoftDeleteModel):
    STATUS_DRAFT = "draft"
    STATUS_CONFIRMED = "confirmed"
    STATUS_CHOICES = [(STATUS_DRAFT, STATUS_DRAFT), (STATUS_CONFIRMED, STATUS_CONFIRMED)]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="goods_received_notes")
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="goods_received_notes")
    grn_number = models.CharField(max_length=40)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="draft")
    delivery_date = models.DateField(default=timezone.localdate)
    notes = models.TextField(blank=True)
    idempotency_key = models.CharField(max_length=120, blank=True)
    confirmed_at = models.DateTimeField(blank=True, null=True)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, blank=True, null=True, related_name="confirmed_goods_received_notes"
    )

    class Meta:
        ordering = ["-delivery_date", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "grn_number"], name="unique_grn_number_per_user"),
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_grn_idempotency_key_per_user",
            ),
        ]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.grn_number:
            self.grn_number = f"GRN-{self.pk:06d}"
            GoodsReceivedNote.objects.filter(pk=self.pk).update(grn_number=self.grn_number)


class GoodsReceivedNoteItem(TimeStampedSoftDeleteModel):
    goods_received_note = models.ForeignKey(GoodsReceivedNote, on_delete=models.PROTECT, related_name="items")
    purchase_order_item = models.ForeignKey(PurchaseOrderItem, on_delete=models.PROTECT, related_name="goods_received_items")
    quantity_delivered = models.PositiveIntegerField()
    quantity_damaged = models.PositiveIntegerField(default=0)
    quantity_missing = models.PositiveIntegerField(default=0)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    unit_cost_base = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    discount_amount_base = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    additional_charges_base = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_cost_base = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    batch_number = models.CharField(max_length=100, blank=True)
    expiry_date = models.DateField(blank=True, null=True)
    batch = models.ForeignKey(ProductBatch, on_delete=models.SET_NULL, blank=True, null=True, related_name="received_items")
    stock_movement = models.ForeignKey(
        "StockMovement", on_delete=models.SET_NULL, blank=True, null=True, related_name="goods_received_items"
    )

    @property
    def quantity_accepted(self):
        return self.quantity_delivered - self.quantity_damaged


class GoodsReceivedNoteAttachment(TimeStampedSoftDeleteModel):
    goods_received_note = models.ForeignKey(GoodsReceivedNote, on_delete=models.PROTECT, related_name="attachments")
    file = models.FileField(upload_to="goods_received_documents/")
    file_name = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="grn_attachments")


class PurchaseCostHistory(TimeStampedSoftDeleteModel):
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="purchase_cost_history")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchase_cost_history")
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="cost_history")
    goods_received_note_item = models.OneToOneField(
        GoodsReceivedNoteItem, on_delete=models.PROTECT, related_name="cost_history"
    )
    quantity = models.PositiveIntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10)
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6)
    unit_cost_base = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["product", "supplier", "created_at"])]


class SupplierReturn(TimeStampedSoftDeleteModel):
    REASON_CHOICES = [
        ("damaged", "Damaged products"),
        ("incorrect", "Incorrect delivery"),
        ("expired", "Expired products"),
        ("excess", "Excess delivery"),
        ("other", "Other"),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="supplier_returns")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="returns")
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="supplier_returns")
    reason = models.CharField(max_length=20, choices=REASON_CHOICES)
    return_date = models.DateField(default=timezone.localdate)
    reference = models.CharField(max_length=120, blank=True)
    idempotency_key = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)
    total_amount_base = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recorded_supplier_returns")

    class Meta:
        ordering = ["-return_date", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_supplier_return_key_per_user",
            )
        ]


class SupplierReturnItem(TimeStampedSoftDeleteModel):
    supplier_return = models.ForeignKey(SupplierReturn, on_delete=models.PROTECT, related_name="items")
    goods_received_note_item = models.ForeignKey(
        GoodsReceivedNoteItem, on_delete=models.PROTECT, related_name="supplier_return_items"
    )
    quantity = models.PositiveIntegerField()
    quantity_damaged = models.PositiveIntegerField(default=0)
    unit_cost_base = models.DecimalField(max_digits=14, decimal_places=2)
    total_amount_base = models.DecimalField(max_digits=14, decimal_places=2)
    stock_movement = models.ForeignKey(
        "StockMovement", on_delete=models.PROTECT, blank=True, null=True, related_name="supplier_return_items"
    )


class SupplierPayment(TimeStampedSoftDeleteModel):
    METHOD_CHOICES = [
        ("cash", "Cash"),
        ("bank", "Bank transfer"),
        ("mobile_money", "Mobile money"),
        ("card", "Card"),
        ("other", "Other"),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="supplier_payments")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="payments")
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="payments")
    financial_account = models.ForeignKey(
        "reports.BankAccount",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="supplier_payments",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10)
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    amount_base = models.DecimalField(max_digits=12, decimal_places=2)
    payment_date = models.DateField()
    method = models.CharField(max_length=20, choices=METHOD_CHOICES, default="cash")
    reference = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)
    idempotency_key = models.CharField(max_length=120, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recorded_supplier_payments")

    class Meta:
        indexes = [models.Index(fields=["user", "supplier", "payment_date"])]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_supplier_payment_key_per_user",
            )
        ]


class SupplyEntry(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    request_id = models.CharField(max_length=100)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    direction = models.CharField(max_length=10, choices=[("incoming", "incoming"), ("outgoing", "outgoing")])
    payment_status = models.CharField(max_length=10, choices=[("pending", "pending"), ("partial", "partial"), ("paid", "paid")])
    partner_name = models.CharField(max_length=255)
    partner_category = models.CharField(max_length=20)
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10)
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6)
    movement_date = models.DateField()
    movement_time = models.TimeField()
    notes = models.TextField(blank=True)
    invoice_number = models.CharField(max_length=50)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "request_id"], name="unique_supply_request")]
