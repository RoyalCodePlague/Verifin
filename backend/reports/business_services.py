import io
import logging
import re
from datetime import date as date_class, datetime, time as time_class, timedelta, timezone
from decimal import Decimal
from django.db import models
from django.db.models import Sum
from django.utils import timezone as django_timezone
from PIL import Image, ImageFilter, ImageOps
from inventory.models import Product

logger = logging.getLogger(__name__)


class ReceiptScanError(Exception):
    pass


def make_json_safe(value):
    """Convert Django/queryset values into plain JSON primitives."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date_class, time_class)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: make_json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [make_json_safe(item) for item in value]
    return value


def get_user_currency(user):
    return getattr(user, "currency", "ZAR") or "ZAR"


def get_user_currency_symbol(user):
    return getattr(user, "currency_symbol", "R") or "R"


def format_user_money(amount, user):
    symbol = get_user_currency_symbol(user)
    return f"{symbol}{float(amount or 0):.2f}"

def query_stock(filters: dict = None, user=None) -> dict:
    """Get real inventory data from Product model"""
    try:
        from inventory.models import Product

        products = Product.objects.filter(user=user, is_deleted=False) if user else Product.objects.filter(is_deleted=False)
        if filters:
            products = products.filter(**filters)

        products_data = list(products.values('id', 'name', 'stock', 'sku', 'price'))
        total_qty = sum(p['stock'] for p in products_data)

        return {
            "products": products_data,
            "total_items": len(products_data),
            "total_quantity": total_qty,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error querying stock: {e}")
        return {"error": str(e), "products": [], "total_quantity": 0}

def query_expenses(filters: dict = None, user=None) -> dict:
    """Get real expense data"""
    try:
        from expenses.models import Expense

        expenses = Expense.objects.filter(created_by=user, is_deleted=False) if user else Expense.objects.filter(is_deleted=False)
        if filters:
            expenses = expenses.filter(**filters)

        expenses_data = list(expenses.values('id', 'category', 'amount', 'amount_base', 'currency', 'date'))
        total = sum((e.get('amount_base') or e.get('amount') or 0) for e in expenses_data)

        return {
            "expenses": expenses_data,
            "total_cost": total,
            "count": len(expenses_data),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error querying expenses: {e}")
        return {"error": str(e), "expenses": [], "total_cost": 0}

def query_sales(filters: dict = None, user=None) -> dict:
    """Get real sales data"""
    try:
        from sales.models import Sale, SaleItem

        sales = Sale.objects.filter(created_by=user, is_deleted=False) if user else Sale.objects.filter(is_deleted=False)
        if filters:
            sales = sales.filter(**filters)

        # Get sales summary
        sales_data = list(sales.values('id', 'total', 'date', 'payment_method'))
        total_revenue = sales.aggregate(Sum('total'))['total__sum'] or 0

        # Get detailed items from SaleItem
        sale_items = SaleItem.objects.filter(sale__in=sales).values(
            'id', 'product__name', 'quantity', 'unit_price', 'subtotal'
        )

        return {
            "sales": sales_data,
            "items": list(sale_items),
            "total_revenue": float(total_revenue) if total_revenue else 0,
            "count": len(sales_data),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error querying sales: {e}")
        return {"error": str(e), "sales": [], "total_revenue": 0}

def query_customers(filters: dict = None, user=None) -> dict:
    """Get real customer data"""
    try:
        from customers.models import Customer

        customers = Customer.objects.filter(user=user, is_deleted=False) if user else Customer.objects.filter(is_deleted=False)
        if filters:
            customers = customers.filter(**filters)

        customers_data = list(customers.values('id', 'name', 'phone', 'created_at'))

        return {
            "customers": customers_data,
            "total_customers": len(customers_data),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error querying customers: {e}")
        return {"error": str(e), "customers": [], "total_customers": 0}

def generate_insights(user=None) -> dict:
    """Generate deterministic business insights from existing data."""
    insights = []
    currency_symbol = get_user_currency_symbol(user)

    try:
        # Low stock alert
        from inventory.models import Product
        products = Product.objects.filter(user=user, is_deleted=False) if user else Product.objects.filter(is_deleted=False)
        low_stock = products.filter(stock__lte=models.F("reorder_level")).count()
        if low_stock > 0:
            insights.append({
                "type": "low_stock_alert",
                "severity": "warning",
                "message": f"{low_stock} products have low stock levels"
            })
    except Exception as e:
        logger.error(f"Error getting low stock alert: {e}")

    try:
        # Sales trend
        from sales.models import Sale, SaleItem

        today = django_timezone.localdate()
        week_ago = today - timedelta(days=7)
        sales = Sale.objects.filter(created_by=user, is_deleted=False) if user else Sale.objects.filter(is_deleted=False)
        today_total = sales.filter(date=today).aggregate(total=Sum("total"))["total"] or 0
        seven_day_total = sales.filter(date__gte=week_ago, date__lt=today).aggregate(total=Sum("total"))["total"] or 0
        average = seven_day_total / 7 if seven_day_total else 0
        if average and today_total < average:
            insights.append({
                "type": "sales_lower_than_usual",
                "severity": "warning",
                "message": f"Sales are lower than usual today. Today: {currency_symbol}{today_total:.2f}, 7-day average: {currency_symbol}{average:.2f}."
            })
        elif average and today_total > average:
            insights.append({
                "type": "sales_above_average",
                "severity": "success",
                "message": f"Sales are above the 7-day average today. Today: {currency_symbol}{today_total:.2f}, average: {currency_symbol}{average:.2f}."
            })

        fast_movers = (
            SaleItem.objects.filter(sale__in=sales.filter(date__gte=week_ago))
            .values("product__name")
            .annotate(quantity=Sum("quantity"))
            .order_by("-quantity")[:3]
        )
        for item in fast_movers:
            insights.append({
                "type": "fast_moving_product",
                "severity": "info",
                "message": f"{item['product__name']} is moving fast with {item['quantity']} units sold in the last 7 days."
            })
    except Exception as e:
        logger.error(f"Error getting sales trend: {e}")

    return {
        "insights": insights,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


def generate_reorder_suggestions(user, days=7, cover_days=14):
    from sales.models import SaleItem

    since = django_timezone.localdate() - timedelta(days=max(days, 1))
    rows = []
    products = Product.objects.filter(user=user, is_deleted=False)
    for product in products:
        sold = SaleItem.objects.filter(
            product=product,
            sale__created_by=user,
            sale__date__gte=since,
            is_deleted=False,
        ).aggregate(total=Sum("quantity"))["total"] or 0
        avg_daily = sold / max(days, 1)
        target_stock = max(product.reorder_level, round(avg_daily * cover_days))
        suggested = max(0, target_stock - product.stock)
        if suggested > 0 or product.stock <= product.reorder_level:
            rows.append({
                "product_id": product.id,
                "product": product.name,
                "stock": product.stock,
                "reorder_level": product.reorder_level,
                "sold_in_period": sold,
                "average_daily_sales": round(avg_daily, 2),
                "cover_days": cover_days,
                "suggested_reorder_quantity": suggested,
                "reason": "Below reorder level" if product.stock <= product.reorder_level else "Projected demand cover",
            })
    return {"days": days, "cover_days": cover_days, "items": rows}


def generate_whatsapp_summary(user):
    from expenses.models import Expense
    from sales.models import Sale

    today = django_timezone.localdate()
    sales = Sale.objects.filter(created_by=user, date=today, is_deleted=False)
    expenses = Expense.objects.filter(created_by=user, date=today, is_deleted=False)
    products = Product.objects.filter(user=user, is_deleted=False)
    sales_total = sales.aggregate(total=Sum("total"))["total"] or 0
    expenses_total = expenses.aggregate(total=Sum("amount_base"))["total"] or 0
    low_stock = products.filter(stock__lte=models.F("reorder_level"))[:5]
    lines = [
        "*Verifin Daily Summary*",
        today.strftime("%A, %d %B %Y"),
        "",
        f"*Sales:* {format_user_money(sales_total, user)} ({sales.count()} transactions)",
        f"*Expenses:* {format_user_money(expenses_total, user)}",
        f"*Net:* {format_user_money(sales_total - expenses_total, user)}",
        f"*Products:* {products.count()} active items",
    ]
    if low_stock:
        lines.extend(["", "*Low Stock:*"])
        lines.extend([f"- {p.name}: {p.stock} left" for p in low_stock])
    lines.append("\n_Copy and send via WhatsApp._")
    return {"message": "\n".join(lines), "date": today, "channel": "whatsapp_copy"}


def simulate_receipt_scan(upload_name="", merchant="", amount=None, category="General", note=""):
    parsed_amount = None
    if amount not in [None, ""]:
        try:
            parsed_amount = float(amount)
        except (TypeError, ValueError):
            parsed_amount = None
    return {
        "status": "manual_review",
        "source_file": upload_name,
        "parsed": {
            "merchant": merchant.strip() or "Unknown merchant",
            "amount": parsed_amount,
            "category": category or "General",
            "note": note,
        },
        "message": "Receipt captured for manual review. No external OCR provider was used.",
    }


EXPENSE_CATEGORY_KEYWORDS = {
    "Transport": ("fuel", "taxi", "uber", "bolt", "bus", "transport", "parking", "petrol", "diesel"),
    "Utilities": ("electric", "water", "utility", "utilities", "zesa", "airtime", "internet"),
    "Stock Purchase": ("wholesale", "supplier", "cash carry", "stock", "goods", "invoice"),
    "Communication": ("phone", "mobile", "data", "sim", "vodacom", "mtn", "econet", "telecel"),
    "Rent": ("rent", "lease", "landlord"),
    "Salary": ("salary", "wage", "payroll", "staff"),
}


def _manual_receipt_result(upload_name="", message="OCR could not read enough detail. Enter the expense manually."):
    result = simulate_receipt_scan(upload_name=upload_name, category="Other")
    result["status"] = "manual_review"
    result["message"] = message
    return result


def _receipt_image_to_text(content):
    try:
        import pytesseract
    except ImportError as exc:
        raise ReceiptScanError("Tesseract OCR is not installed in the Python environment.") from exc

    image = Image.open(io.BytesIO(content))
    image = ImageOps.exif_transpose(image).convert("L")
    image = ImageOps.autocontrast(image)
    image = image.filter(ImageFilter.SHARPEN)
    if image.width < 1200:
        scale = 1200 / max(image.width, 1)
        image = image.resize((1200, int(image.height * scale)))

    return pytesseract.image_to_string(image, config="--oem 3 --psm 6")


def _parse_receipt_amount(text):
    money_pattern = re.compile(r"(?<!\d)(?:[A-Z]{1,3}\$?|R|\$)?\s*(\d{1,6}(?:[,\s]\d{3})*(?:[.,]\d{2})|\d{1,6})(?!\d)")
    priority_lines = [line for line in text.splitlines() if re.search(r"\b(total|amount due|balance|grand total)\b", line, re.I)]
    candidates = []
    for line in priority_lines or text.splitlines():
        for match in money_pattern.findall(line):
            normalized = match.replace(" ", "").replace(",", "")
            try:
                value = float(normalized)
            except ValueError:
                continue
            if 0 < value < 1_000_000:
                candidates.append(value)
    return max(candidates) if candidates else None


def _parse_receipt_date(text):
    patterns = [
        r"\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b",
        r"\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b",
        r"\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if not match:
            continue
        raw = match.group(1).replace("/", "-")
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%m-%d-%Y", "%d-%m-%y", "%m-%d-%y", "%d %b %Y", "%d %B %Y", "%d %b %y", "%d %B %y"):
            try:
                return datetime.strptime(raw, fmt).date().isoformat()
            except ValueError:
                continue
    return ""


def _parse_receipt_merchant(text):
    skip = re.compile(r"(receipt|invoice|tax|vat|date|time|total|amount|cash|card|change|tel|phone)", re.I)
    for line in text.splitlines()[:10]:
        cleaned = re.sub(r"[^A-Za-z0-9 '&.-]", " ", line).strip()
        cleaned = re.sub(r"\s+", " ", cleaned)
        if len(cleaned) >= 3 and not skip.search(cleaned) and not re.search(r"\d{4,}", cleaned):
            return cleaned[:80]
    return "Unknown merchant"


def _parse_receipt_category(text):
    lowered = text.lower()
    for category, keywords in EXPENSE_CATEGORY_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            return category
    return "Other"


def parse_receipt_ocr_text(text, upload_name=""):
    cleaned_text = (text or "").strip()
    if len(cleaned_text) < 8:
        return _manual_receipt_result(upload_name)

    parsed = {
        "merchant": _parse_receipt_merchant(cleaned_text),
        "amount": _parse_receipt_amount(cleaned_text),
        "date": _parse_receipt_date(cleaned_text),
        "category": _parse_receipt_category(cleaned_text),
        "note": cleaned_text[:500],
    }
    if parsed["amount"] is None:
        return _manual_receipt_result(upload_name, "OCR read the receipt text, but could not find an amount. Enter it manually.")
    result = _normalize_receipt_scan(parsed, upload_name=upload_name)
    result["status"] = "ocr_parsed"
    result["message"] = "Receipt OCR read the image. Review the extracted details before saving."
    return result


def _normalize_receipt_scan(parsed, upload_name=""):
    amount = parsed.get("amount")
    try:
        amount = float(amount) if amount not in [None, ""] else None
    except (TypeError, ValueError):
        amount = None

    return {
        "status": "parsed",
        "source_file": upload_name,
        "parsed": {
            "merchant": (parsed.get("merchant") or parsed.get("description") or "").strip() or "Unknown merchant",
            "amount": amount,
            "date": (parsed.get("date") or "").strip(),
            "category": (parsed.get("category") or "Other").strip() or "Other",
            "note": (parsed.get("note") or "").strip(),
        },
        "message": "Receipt read. Review the extracted details before saving.",
    }


def scan_receipt_image(upload):
    if not upload:
        return _manual_receipt_result(message="Upload a receipt image to scan, or enter the expense manually.")

    upload_name = getattr(upload, "name", "")
    try:
        content = upload.read()
        if not content:
            return _manual_receipt_result(upload_name, "The uploaded receipt image is empty. Enter the expense manually.")
        text = _receipt_image_to_text(content)
        return parse_receipt_ocr_text(text, upload_name=upload_name)
    except Exception as exc:
        logger.exception("Receipt image scan failed: %s", exc)
        return _manual_receipt_result(upload_name, "OCR could not read this image. Try a clearer photo or enter the expense manually.")
