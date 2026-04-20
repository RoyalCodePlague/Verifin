from django.contrib import admin

from .models import BillingCycle, FeatureLimit, Payment, Plan, RegionPrice, Subscription, SubscriptionEvent, TrialPeriod, UsageTracking
from .services import activate_plan, cancel_subscription, renew_subscription, sync_plan_catalog


@admin.action(description="Sync built-in billing plans")
def sync_plans(modeladmin, request, queryset):
    sync_plan_catalog(force=True)


class FeatureLimitInline(admin.TabularInline):
    model = FeatureLimit
    extra = 0
    fields = ["key", "label", "enabled", "limit", "unit"]


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "monthly_price", "yearly_price", "is_public", "sort_order"]
    list_filter = ["is_public"]
    search_fields = ["name", "code"]
    inlines = [FeatureLimitInline]
    actions = [sync_plans]


@admin.action(description="Activate Growth monthly")
def activate_growth(modeladmin, request, queryset):
    for subscription in queryset:
        activate_plan(subscription.user, Plan.GROWTH, Subscription.MONTHLY, actor=request.user)


@admin.action(description="Activate Business monthly")
def activate_business(modeladmin, request, queryset):
    for subscription in queryset:
        activate_plan(subscription.user, Plan.BUSINESS, Subscription.MONTHLY, actor=request.user)


@admin.action(description="Renew selected subscriptions")
def renew_selected(modeladmin, request, queryset):
    for subscription in queryset:
        renew_subscription(subscription.user, actor=request.user)


@admin.action(description="Cancel immediately")
def cancel_selected(modeladmin, request, queryset):
    for subscription in queryset:
        cancel_subscription(subscription.user, at_period_end=False, actor=request.user)


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "plan", "status", "billing_period", "current_period_end", "trial_ends_at", "cancel_at_period_end"]
    list_filter = ["status", "billing_period", "plan"]
    search_fields = ["user__email", "user__business_name"]
    readonly_fields = ["provider", "provider_customer_id", "provider_subscription_id"]
    actions = [activate_growth, activate_business, renew_selected, cancel_selected]


@admin.register(RegionPrice)
class RegionPriceAdmin(admin.ModelAdmin):
    list_display = ["country_code", "country_name", "plan", "currency", "currency_symbol", "monthly_price", "yearly_price", "is_default"]
    list_filter = ["country_code", "currency", "is_default"]
    search_fields = ["country_code", "country_name", "plan__name"]


@admin.register(BillingCycle)
class BillingCycleAdmin(admin.ModelAdmin):
    list_display = ["subscription", "period_start", "period_end", "amount", "currency", "status", "paid_at"]
    list_filter = ["status", "currency"]


@admin.register(UsageTracking)
class UsageTrackingAdmin(admin.ModelAdmin):
    list_display = ["subscription", "key", "used", "period_start", "period_end"]
    search_fields = ["subscription__user__email", "key"]


@admin.register(TrialPeriod)
class TrialPeriodAdmin(admin.ModelAdmin):
    list_display = ["subscription", "plan", "started_at", "ends_at", "converted_at", "expired_at"]


@admin.register(SubscriptionEvent)
class SubscriptionEventAdmin(admin.ModelAdmin):
    list_display = ["subscription", "event_type", "provider", "created_by", "created_at"]
    list_filter = ["event_type", "provider"]
    search_fields = ["subscription__user__email", "event_type"]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["subscription", "amount", "currency", "status", "provider", "created_at"]
    list_filter = ["status", "provider", "currency"]
