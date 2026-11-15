from decimal import Decimal

from django.db.models import Sum


def get_purchase_orders_received_totals_base(orders):
    """Return confirmed GRN costs plus legacy received quantities for each order."""
    from collections import defaultdict

    from .models import GoodsReceivedNote, GoodsReceivedNoteItem, PurchaseOrderItem

    orders = list(orders)
    order_ids = [order.pk for order in orders]
    if not order_ids:
        return {}

    confirmed_items = GoodsReceivedNoteItem.objects.filter(
        goods_received_note__purchase_order_id__in=order_ids,
        goods_received_note__status=GoodsReceivedNote.STATUS_CONFIRMED,
        goods_received_note__is_deleted=False,
        is_deleted=False,
    )
    grn_totals = {
        row["goods_received_note__purchase_order_id"]: row["total"] or Decimal("0")
        for row in confirmed_items.values("goods_received_note__purchase_order_id").annotate(
            total=Sum("total_cost_base")
        )
    }
    delivered_by_item = {
        row["purchase_order_item_id"]: row["quantity"] or 0
        for row in confirmed_items.values("purchase_order_item_id").annotate(
            quantity=Sum("quantity_delivered")
        )
    }

    legacy_totals = defaultdict(lambda: Decimal("0"))
    for item in PurchaseOrderItem.objects.filter(
        purchase_order_id__in=order_ids,
        is_deleted=False,
    ).values("id", "purchase_order_id", "quantity_received", "unit_cost_base"):
        legacy_quantity = max(item["quantity_received"] - delivered_by_item.get(item["id"], 0), 0)
        legacy_totals[item["purchase_order_id"]] += item["unit_cost_base"] * legacy_quantity

    return {
        order_id: {
            "grn_total_base": grn_totals.get(order_id, Decimal("0")),
            "legacy_total_base": legacy_totals[order_id],
            "received_total_base": grn_totals.get(order_id, Decimal("0")) + legacy_totals[order_id],
        }
        for order_id in order_ids
    }


def get_purchase_order_received_totals_base(order):
    """Return confirmed GRN costs and any pre-GRN received quantities in base currency."""
    return get_purchase_orders_received_totals_base([order])[order.pk]
