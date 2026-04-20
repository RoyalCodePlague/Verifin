from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import Profile, Staff, StaffActivityLog, User


class ProfileInline(admin.StackedInline):
    model = Profile
    can_delete = False
    fk_name = "user"
    extra = 0


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ("email",)
    list_display = ("email", "username", "business_name", "onboarding_complete", "is_staff", "is_active", "date_joined")
    list_filter = ("is_staff", "is_active", "onboarding_complete")
    search_fields = ("email", "username", "business_name", "phone")
    readonly_fields = ("date_joined", "last_login")

    fieldsets = (
        (None, {"fields": ("email", "username", "password")}),
        ("Business", {"fields": ("business_name", "phone", "currency", "currency_symbol", "onboarding_complete", "dark_mode")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2", "business_name")}),
    )

    inlines = (ProfileInline,)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "country", "city", "created_at")
    search_fields = ("user__email", "user__business_name", "city", "country")


@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "role", "status", "last_active")
    list_filter = ("role", "status")


@admin.register(StaffActivityLog)
class StaffActivityLogAdmin(admin.ModelAdmin):
    list_display = ("user", "actor", "action", "object_type", "summary", "created_at")
    list_filter = ("action", "object_type")
    search_fields = ("user__email", "actor__email", "summary")
    search_fields = ("name", "user__email")
