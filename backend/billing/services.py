from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import BillingCycle, FeatureLimit, Payment, Plan, Subscription, SubscriptionEvent, TrialPeriod, UsageTracking
from .plans import PLAN_DEFINITIONS


GRACE_PERIOD_DAYS = 7


def sync_plan_catalog():
    for code, definition in PLAN_DEFINITIONS.items():
        plan, _ = Plan.objects.update_or_create(
            code=code,
            defaults={
                "name": definition["name"],
                "description": definition["description"],
                "monthly_price": Decimal(str(definition["monthly_price"])),
                "yearly_price": Decimal(str(definition["yearly_price"])),
                "sort_order": definition["sort_order"],
                "is_public": True,
            },
        )
        for key, (label, enabled, limit, unit) in definition["limits"].items():
            FeatureLimit.objects.update_or_create(
                plan=plan,
                key=key,
                defaults={"label": label, "enabled": enabled, "limit": limit, "unit": unit},
            )
    return Plan.objects.filter(is_deleted=False).prefetch_related("limits")


def period_end(start, billing_period):
    days = 365 if billing_period == Subscription.YEARLY else 30
    return start + timedelta(days=days)


def amount_for(plan, billing_period):
    return plan.yearly_price if billing_period == Subscription.YEARLY else plan.monthly_price


def record_event(subscription, event_type, metadata=None, actor=None, provider=Subscription.PROVIDER_MOCK, provider_event_id=""):
    return SubscriptionEvent.objects.create(
        subscription=subscription,
        event_type=event_type,
        metadata=metadata or {},
        created_by=actor if getattr(actor, "is_authenticated", False) else None,
        provider=provider,
        provider_event_id=provider_event_id,
    )


def get_starter_plan():
    sync_plan_catalog()
    return Plan.objects.get(code=Plan.STARTER, is_deleted=False)


def get_or_create_subscription(user):
    sync_plan_catalog()
    try:
        subscription = user.subscription
    except Subscription.DoesNotExist:
        subscription = None
    if subscription:
        if subscription.is_deleted:
            subscription.is_deleted = False
            subscription.plan = Plan.objects.get(code=Plan.STARTER, is_deleted=False)
            subscription.status = Subscription.ACTIVE
            subscription.current_period_start = timezone.now()
            subscription.current_period_end = None
            subscription.save()
        return refresh_subscription_state(subscription)
    plan = Plan.objects.get(code=Plan.STARTER, is_deleted=False)
    subscription = Subscription.objects.create(
        user=user,
        plan=plan,
        status=Subscription.ACTIVE,
        billing_period=Subscription.MONTHLY,
        current_period_start=timezone.now(),
        current_period_end=None,
    )
    record_event(subscription, "starter_created", {"source": "auto"}, actor=user)
    return subscription


def refresh_subscription_state(subscription):
    now = timezone.now()
    changed = False
    if subscription.status == Subscription.TRIALING and subscription.trial_ends_at and now > subscription.trial_ends_at:
        subscription.status = Subscription.PAST_DUE
        subscription.grace_period_ends_at = subscription.trial_ends_at + timedelta(days=GRACE_PERIOD_DAYS)
        TrialPeriod.objects.filter(subscription=subscription, expired_at__isnull=True).update(expired_at=now)
        record_event(subscription, "trial_expired", actor=subscription.user)
        changed = True
    if subscription.status == Subscription.ACTIVE and subscription.current_period_end and now > subscription.current_period_end:
        subscription.status = Subscription.PAST_DUE
        subscription.grace_period_ends_at = subscription.current_period_end + timedelta(days=GRACE_PERIOD_DAYS)
        record_event(subscription, "subscription_past_due", actor=subscription.user)
        changed = True
    if subscription.status == Subscription.PAST_DUE and subscription.grace_period_ends_at and now > subscription.grace_period_ends_at:
        subscription.status = Subscription.EXPIRED
        subscription.ended_at = now
        record_event(subscription, "subscription_expired", actor=subscription.user)
        changed = True
    if changed:
        subscription.save(update_fields=["status", "grace_period_ends_at", "ended_at", "updated_at"])
    return subscription


@transaction.atomic
def activate_plan(user, plan_code, billing_period=Subscription.MONTHLY, trial_days=0, actor=None):
    sync_plan_catalog()
    if billing_period not in [Subscription.MONTHLY, Subscription.YEARLY]:
        raise ValidationError({"billing_period": "Use monthly or yearly."})
    plan = Plan.objects.get(code=plan_code, is_deleted=False)
    subscription = get_or_create_subscription(user)
    now = timezone.now()
    is_free = plan.code == Plan.STARTER
    is_trial = bool(trial_days and not is_free)
    end_at = None if is_free else period_end(now, billing_period)

    subscription.plan = plan
    subscription.billing_period = billing_period
    subscription.status = Subscription.TRIALING if is_trial else Subscription.ACTIVE
    subscription.current_period_start = now
    subscription.current_period_end = end_at
    subscription.trial_ends_at = now + timedelta(days=int(trial_days)) if is_trial else None
    subscription.grace_period_ends_at = None
    subscription.cancel_at_period_end = False
    subscription.cancelled_at = None
    subscription.ended_at = None
    subscription.save()

    if is_trial:
        TrialPeriod.objects.create(subscription=subscription, plan=plan, started_at=now, ends_at=subscription.trial_ends_at)
        event_type = "trial_started"
    else:
        event_type = "plan_activated"

    amount = amount_for(plan, billing_period)
    if amount > 0 and not is_trial:
        cycle = BillingCycle.objects.create(
            subscription=subscription,
            period_start=now,
            period_end=end_at,
            amount=amount,
            currency=plan.currency,
            paid_at=now,
            status="paid",
        )
        Payment.objects.create(subscription=subscription, amount=amount, currency=plan.currency, status="paid")
        record_event(subscription, "mock_payment_succeeded", {"cycle_id": cycle.id, "amount": str(amount)}, actor=actor or user)

    record_event(subscription, event_type, {"plan": plan.code, "billing_period": billing_period}, actor=actor or user)
    refresh_usage_snapshot(user)
    return subscription


def renew_subscription(user, actor=None):
    subscription = get_or_create_subscription(user)
    if subscription.plan.code == Plan.STARTER:
        subscription.status = Subscription.ACTIVE
        subscription.current_period_end = None
        subscription.save(update_fields=["status", "current_period_end", "updated_at"])
        record_event(subscription, "starter_renewed", actor=actor or user)
        return subscription

    now = timezone.now()
    start = max(now, subscription.current_period_end or now)
    end_at = period_end(start, subscription.billing_period)
    amount = amount_for(subscription.plan, subscription.billing_period)
    subscription.status = Subscription.ACTIVE
    subscription.current_period_start = start
    subscription.current_period_end = end_at
    subscription.trial_ends_at = None
    subscription.grace_period_ends_at = None
    subscription.cancel_at_period_end = False
    subscription.ended_at = None
    subscription.save()
    cycle = BillingCycle.objects.create(
        subscription=subscription,
        period_start=start,
        period_end=end_at,
        amount=amount,
        currency=subscription.plan.currency,
        paid_at=now,
        status="paid",
    )
    Payment.objects.create(subscription=subscription, amount=amount, currency=subscription.plan.currency, status="paid")
    record_event(subscription, "subscription_renewed", {"cycle_id": cycle.id}, actor=actor or user)
    return subscription


def cancel_subscription(user, at_period_end=True, actor=None):
    subscription = get_or_create_subscription(user)
    now = timezone.now()
    subscription.cancel_at_period_end = bool(at_period_end and subscription.current_period_end)
    subscription.cancelled_at = now
    if not subscription.cancel_at_period_end:
        subscription.status = Subscription.CANCELLED
        subscription.ended_at = now
    subscription.save()
    record_event(subscription, "subscription_cancelled", {"at_period_end": subscription.cancel_at_period_end}, actor=actor or user)
    return subscription


def resume_subscription(user, actor=None):
    subscription = get_or_create_subscription(user)
    subscription.cancel_at_period_end = False
    subscription.cancelled_at = None
    if subscription.status in [Subscription.CANCELLED, Subscription.EXPIRED]:
        subscription.status = Subscription.ACTIVE
        subscription.current_period_start = timezone.now()
        if subscription.plan.code != Plan.STARTER:
            subscription.current_period_end = period_end(subscription.current_period_start, subscription.billing_period)
    subscription.save()
    record_event(subscription, "subscription_resumed", actor=actor or user)
    return subscription


def expire_subscription(user, actor=None):
    subscription = get_or_create_subscription(user)
    subscription.status = Subscription.EXPIRED
    subscription.ended_at = timezone.now()
    subscription.save(update_fields=["status", "ended_at", "updated_at"])
    record_event(subscription, "subscription_force_expired", actor=actor or user)
    return subscription


def change_plan(user, plan_code, billing_period=Subscription.MONTHLY, actor=None):
    current = get_or_create_subscription(user)
    target = Plan.objects.get(code=plan_code, is_deleted=False)
    event_type = "plan_changed"
    if target.sort_order > current.plan.sort_order:
        event_type = "plan_upgraded"
    elif target.sort_order < current.plan.sort_order:
        event_type = "plan_downgraded"
    subscription = activate_plan(user, plan_code, billing_period, trial_days=0, actor=actor or user)
    record_event(subscription, event_type, {"from": current.plan.code, "to": target.code}, actor=actor or user)
    return subscription


def _count_for(user, key):
    if key == "users":
        from accounts.models import Staff

        return Staff.objects.filter(user=user, is_deleted=False, status=Staff.ACTIVE).count() + 1
    if key == "products":
        from inventory.models import Product

        return Product.objects.filter(user=user, is_deleted=False).count()
    if key == "customers":
        from customers.models import Customer

        return Customer.objects.filter(user=user, is_deleted=False).count()
    if key == "reports":
        return 0
    return 0


def refresh_usage_snapshot(user):
    subscription = get_or_create_subscription(user)
    now = timezone.now()
    for key in ["users", "products", "customers", "reports"]:
        UsageTracking.objects.update_or_create(
            subscription=subscription,
            key=key,
            period_start=subscription.current_period_start,
            defaults={
                "used": _count_for(user, key),
                "period_end": subscription.current_period_end,
            },
        )
    return subscription.usage.filter(period_start=subscription.current_period_start)


def _feature(subscription, key):
    return subscription.plan.limits.filter(key=key, is_deleted=False).first()


def has_feature(user, key):
    subscription = get_or_create_subscription(user)
    if not subscription.is_entitled:
        return False
    feature = _feature(subscription, key)
    return bool(feature and feature.enabled)


def get_limit(user, key):
    subscription = get_or_create_subscription(user)
    feature = _feature(subscription, key)
    if not feature or not feature.enabled:
        return 0
    return feature.limit


def current_usage(user, key):
    return _count_for(user, key)


def _upgrade_plan_for(key, current_plan):
    current_feature = current_plan.limits.filter(key=key, is_deleted=False).first()
    current_limit = current_feature.limit if current_feature else 0
    for code in [Plan.GROWTH, Plan.BUSINESS]:
        if code == current_plan.code:
            continue
        plan = Plan.objects.filter(code=code, is_deleted=False).first()
        feature = plan.limits.filter(key=key, is_deleted=False).first() if plan else None
        if feature and feature.enabled and (feature.limit is None or feature.limit > (current_limit or 0)):
            return code
    return Plan.BUSINESS


def entitlement_error(subscription, key, limit=None, used=None):
    feature = _feature(subscription, key)
    label = feature.label if feature else key.replace("_", " ").title()
    return {
        "code": "plan_limit_reached" if limit is not None else "feature_locked",
        "detail": f"{label} is not available on your {subscription.plan.name} plan.",
        "feature": key,
        "feature_label": label,
        "plan": subscription.plan.code,
        "limit": limit,
        "used": used,
        "upgrade_plan": _upgrade_plan_for(key, subscription.plan),
    }


def enforce_feature(user, key):
    subscription = get_or_create_subscription(user)
    if has_feature(user, key):
        return True
    raise PermissionDenied(entitlement_error(subscription, key))


def enforce_limit(user, key, increment=1):
    subscription = get_or_create_subscription(user)
    feature = _feature(subscription, key)
    if not subscription.is_entitled or not feature or not feature.enabled:
        raise PermissionDenied(entitlement_error(subscription, key))
    if feature.limit is None:
        return True
    used = current_usage(user, key)
    if used + increment > feature.limit:
        raise ValidationError(entitlement_error(subscription, key, limit=feature.limit, used=used))
    return True


def subscription_payload(user):
    subscription = get_or_create_subscription(user)
    refresh_usage_snapshot(user)
    limits = []
    locked = []
    for feature in subscription.plan.limits.filter(is_deleted=False).order_by("key"):
        used = current_usage(user, feature.key) if feature.key in ["users", "products", "customers", "reports"] else None
        item = {
            "key": feature.key,
            "label": feature.label,
            "enabled": feature.enabled,
            "limit": feature.limit,
            "unit": feature.unit,
            "used": used,
            "remaining": None if feature.limit is None or used is None else max(feature.limit - used, 0),
        }
        limits.append(item)
        if not feature.enabled:
            locked.append(item)
    return {
        "subscription": subscription,
        "plan": subscription.plan,
        "limits": limits,
        "locked_features": locked,
        "events": subscription.events.filter(is_deleted=False)[:10],
        "cycles": subscription.cycles.filter(is_deleted=False)[:6],
        "available_actions": ["mock_checkout", "renew", "upgrade", "downgrade", "cancel", "resume"],
    }
