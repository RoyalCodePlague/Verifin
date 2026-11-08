from rest_framework import serializers

from .models import AutomationPreferences, CustomReport, default_automation_rules


class AutomationPreferencesSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationPreferences
        fields = ["enabled_rules", "severity", "channel"]

    def validate_enabled_rules(self, value):
        defaults = default_automation_rules()
        if not isinstance(value, dict):
            raise serializers.ValidationError("Rules must be an object of boolean values.")
        if set(value) - set(defaults):
            raise serializers.ValidationError("One or more automation rules are not supported.")
        if any(type(enabled) is not bool for enabled in value.values()):
            raise serializers.ValidationError("Each automation rule must be enabled or disabled.")
        return {**defaults, **value}


class CustomReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomReport
        fields = [
            "id", "name", "metric", "group_by", "start_date", "end_date",
            "branch_filter", "branch", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name for this report.")
        return value

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        branch_filter = attrs.get("branch_filter", getattr(self.instance, "branch_filter", "all"))
        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError({"end_date": "End date must be on or after the start date."})
        if branch_filter == "branch" and not branch:
            raise serializers.ValidationError({"branch": "Choose a branch for this filter."})
        if branch_filter != "branch" and branch:
            raise serializers.ValidationError({"branch": "A branch may only be set with the branch filter."})
        if branch and user and branch.user_id != user.id:
            raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
        return attrs
