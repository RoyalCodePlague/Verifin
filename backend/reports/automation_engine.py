from datetime import timedelta
from decimal import Decimal
from functools import partial
import logging

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from billing.services import has_feature
from .models import AutomationExecution, AutomationRule

logger = logging.getLogger(__name__)


def _decimal(value, default=Decimal("0")):
    try:
        return Decimal(str(value))
    except Exception:
        return default


def automation_requires_expense_approval(user, amount_base):
    if not has_feature(user, "automation_rules"):
        return False
    amount = _decimal(amount_base)
    rules = AutomationRule.objects.filter(
        user=user,
        trigger="expense_exceeds_limit",
        action="require_manager_approval",
        enabled=True,
        is_deleted=False,
    )
    return any(amount >= _decimal(rule.conditions.get("amount_base")) for rule in rules)


def queue_automation_event(user, trigger, event_key, object_type, object_id, metrics=None):
    transaction.on_commit(partial(
        _safe_dispatch_automation_event,
        user, trigger, event_key, object_type, str(object_id), dict(metrics or {}),
    ))


def _safe_dispatch_automation_event(*args):
    try:
        dispatch_automation_event(*args)
    except Exception:
        logger.exception("Failed to dispatch a committed automation event")


def _matches(rule, metrics):
    conditions = rule.conditions or {}
    thresholds = {
        "stock_below_minimum": ("maximum_stock", "stock", "lte"),
        "customer_overdue": ("minimum_debt_base", "debt_amount", "gte"),
        "expense_exceeds_limit": ("amount_base", "amount_base", "gte"),
        "purchase_order_approved": ("minimum_amount_base", "total_amount_base", "gte"),
        "till_session_closed": ("minimum_variance_base", "absolute_variance_base", "gte"),
    }
    condition_key, metric_key, comparison = thresholds[rule.trigger]
    if condition_key not in conditions:
        return True
    actual = _decimal(metrics.get(metric_key))
    expected = _decimal(conditions[condition_key])
    return actual <= expected if comparison == "lte" else actual >= expected


def dispatch_automation_event(user, trigger, event_key, object_type, object_id, metrics=None):
    """Run matching, idempotent rules for one committed business event."""
    if not has_feature(user, "automation_rules"):
        return []
    metrics = metrics or {}
    executions = []
    rules = AutomationRule.objects.filter(
        user=user, trigger=trigger, enabled=True, is_deleted=False,
    ).order_by("id")
    for rule in rules:
        if not _matches(rule, metrics):
            continue
        try:
            with transaction.atomic():
                execution, created = AutomationExecution.objects.get_or_create(
                    rule=rule,
                    event_key=event_key[:180],
                    defaults={
                        "user": user,
                        "object_type": object_type,
                        "object_id": str(object_id),
                        "status": "running",
                        "attempts": 1,
                    },
                )
                if not created:
                    execution = AutomationExecution.objects.select_for_update().get(pk=execution.pk)
                    if execution.status in {"running", "succeeded"}:
                        executions.append(execution)
                        continue
                    execution.status = "running"
                    execution.attempts += 1
                    execution.last_error = ""
                    execution.started_at = timezone.now()
                    execution.completed_at = None
                    execution.save(update_fields=["status", "attempts", "last_error", "started_at", "completed_at", "updated_at"])
        except IntegrityError:
            existing = AutomationExecution.objects.filter(rule=rule, event_key=event_key[:180]).first()
            if existing:
                executions.append(existing)
                continue
            raise

        try:
            _run_action(execution)
        except Exception as exc:
            AutomationExecution.objects.filter(pk=execution.pk).update(
                status="failed", last_error=str(exc)[:500], completed_at=timezone.now(), updated_at=timezone.now(),
            )
        execution.refresh_from_db()
        executions.append(execution)
    return executions


def _run_action(execution):
    from notifications.models import NotificationLog

    user = execution.user
    rule = execution.rule
    object_id = execution.object_id
    with transaction.atomic():
        if execution.object_type == "product":
            from inventory.models import Product

            obj = Product.objects.get(pk=object_id, user=user, is_deleted=False)
            message = f"{obj.name} has {obj.stock} units remaining (reorder level: {obj.reorder_level})."
        elif execution.object_type == "customer":
            from customers.models import Customer

            obj = Customer.objects.get(pk=object_id, user=user, is_deleted=False)
            message = f"{obj.name} has an overdue balance of {obj.debt_amount} {user.currency}."
        elif execution.object_type == "expense":
            from expenses.models import Expense

            obj = Expense.objects.get(pk=object_id, created_by=user, is_deleted=False)
            if rule.action == "require_manager_approval":
                message = f"Expense {obj.description} ({obj.amount_base} {user.currency} base) requires manager approval."
            else:
                message = f"Expense {obj.description} exceeds an automation limit ({obj.amount_base} {user.currency} base)."
        elif execution.object_type == "purchase_order":
            from inventory.models import PurchaseOrder

            obj = PurchaseOrder.objects.get(pk=object_id, user=user, is_deleted=False)
            message = f"Purchase order {obj.order_number or obj.pk} was approved; total {obj.total_cost_base} {user.currency} base."
        elif execution.object_type == "till_session":
            from sales.models import TillSession

            obj = TillSession.objects.get(pk=object_id, user=user, is_deleted=False)
            message = (
                f"Till {obj.pk} reconciliation: expected {obj.expected_cash}, counted {obj.closing_cash}, "
                f"variance {obj.cash_variance} {user.currency}."
            )
        else:
            raise ValueError("Unsupported automation event object.")

        if rule.action == "require_manager_approval":
            if execution.object_type != "expense" or obj.approval_status != "pending":
                raise ValueError("The expense was not held for manager approval before account posting.")
        elif rule.action in {"create_notification", "create_follow_up", "create_reconciliation_summary"}:
            if rule.action == "create_follow_up" and execution.object_type != "customer":
                raise ValueError("Customer follow-up actions require an overdue customer event.")
            if rule.action == "create_reconciliation_summary" and execution.object_type != "till_session":
                raise ValueError("Reconciliation summaries require a closed till session.")
            NotificationLog.objects.create(
                user=user,
                type={
                    "create_notification": f"automation_{rule.trigger}",
                    "create_follow_up": "customer_follow_up_reminder",
                    "create_reconciliation_summary": "till_reconciliation_summary",
                }[rule.action],
                message=message,
                channel="push",
            )
        else:
            raise ValueError("Unsupported automation action.")

        execution.status = "succeeded"
        execution.message = message
        execution.last_error = ""
        execution.completed_at = timezone.now()
        execution.save(update_fields=["status", "message", "last_error", "completed_at", "updated_at"])


def retry_automation_execution(execution):
    with transaction.atomic():
        execution = AutomationExecution.objects.select_for_update().select_related("rule", "user").get(pk=execution.pk)
        if execution.status != "failed":
            raise ValueError("Only failed automation executions can be retried.")
        if not execution.rule.enabled or execution.rule.is_deleted:
            raise ValueError("Enable this automation rule before retrying its execution.")
        if not has_feature(execution.user, "automation_rules"):
            raise ValueError("Automation rules are not available on this subscription.")
        execution.status = "running"
        execution.attempts += 1
        execution.last_error = ""
        execution.started_at = timezone.now()
        execution.completed_at = None
        execution.save(update_fields=["status", "attempts", "last_error", "started_at", "completed_at", "updated_at"])
    try:
        _run_action(execution)
    except Exception as exc:
        AutomationExecution.objects.filter(pk=execution.pk).update(
            status="failed", last_error=str(exc)[:500], completed_at=timezone.now(), updated_at=timezone.now(),
        )
    execution.refresh_from_db()
    return execution


def recover_stale_automation_executions(now=None, stale_after_minutes=15):
    now = now or timezone.now()
    cutoff = now - timedelta(minutes=stale_after_minutes)
    stale = AutomationExecution.objects.filter(status="running", started_at__lt=cutoff).select_related("rule", "user")
    recovered = 0
    for execution in stale.iterator():
        claimed = AutomationExecution.objects.filter(pk=execution.pk, status="running").update(
            status="failed", last_error="Execution timed out before completion.", completed_at=now, updated_at=now,
        )
        if not claimed:
            continue
        execution.refresh_from_db()
        if (
            execution.status == "failed"
            and execution.rule.enabled
            and not execution.rule.is_deleted
            and has_feature(execution.user, "automation_rules")
        ):
            retry_automation_execution(execution)
            recovered += 1
    return recovered


def evaluate_scheduled_automations(today=None):
    """Evaluate periodic stock and overdue-account triggers; safe to rerun."""
    from customers.models import Customer
    from inventory.models import Product

    today = today or timezone.localdate()
    User = get_user_model()
    users = User.objects.filter(automation_rules__enabled=True, automation_rules__is_deleted=False).distinct()
    processed = 0
    for user in users.iterator():
        if not has_feature(user, "automation_rules"):
            continue
        stock_rules = AutomationRule.objects.filter(user=user, trigger="stock_below_minimum", enabled=True, is_deleted=False)
        if stock_rules.exists():
            products = Product.objects.filter(user=user, is_deleted=False, stock__lte=F("reorder_level"))
            for product in products.iterator():
                result = dispatch_automation_event(
                    user, "stock_below_minimum", f"product:{product.pk}:{today.isoformat()}", "product", product.pk,
                    {"stock": product.stock, "reorder_level": product.reorder_level},
                )
                processed += len(result)
        overdue_rules = AutomationRule.objects.filter(user=user, trigger="customer_overdue", enabled=True, is_deleted=False)
        if overdue_rules.exists():
            customers = Customer.objects.filter(
                user=user, is_deleted=False, debt_amount__gt=0, debt_due_date__lt=today,
            )
            for customer in customers.iterator():
                result = dispatch_automation_event(
                    user, "customer_overdue", f"customer:{customer.pk}:{today.isoformat()}", "customer", customer.pk,
                    {"debt_amount": customer.debt_amount},
                )
                processed += len(result)
    return processed
