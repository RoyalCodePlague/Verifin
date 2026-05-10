from django.contrib.auth import authenticate, get_user_model, password_validation
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import Profile, Staff, StaffActivityLog

User = get_user_model()


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Token serializer that accepts email instead of username"""
    email = serializers.EmailField(required=True)
    username_field = User.USERNAME_FIELD  # 'email'
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Remove the 'username' field if it exists, since we're using 'email'
        if 'username' in self.fields:
            del self.fields['username']
    
    def validate(self, attrs):
        # Extract email and password
        email = attrs.get('email', '').strip().lower()
        password = attrs.get('password')
        
        if not email or not password:
            raise serializers.ValidationError({
                'detail': 'Email and password are required.'
            })
        
        existing_user = User.objects.filter(email__iexact=email).first()

        # Authenticate using email and password
        user = authenticate(username=existing_user.email if existing_user else email, password=password)
        
        if user is None:
            # Check if user exists
            if not existing_user:
                raise serializers.ValidationError({
                    'detail': 'User Not Found. Please sign up to create an account.'
                })
            raise serializers.ValidationError({
                'detail': 'Invalid email or password.'
            })

        # Return refresh and access tokens
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(user)
        
        return {
            'refresh': str(refresh),
            'access': str(refresh.access_token),
        }


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    referral_code = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ["id", "email", "password", "phone", "business_name", "referral_code"]

    def validate_email(self, value):
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate_referral_code(self, value):
        code = (value or "").strip().upper()
        if not code:
            return ""
        from billing.models import ReferralCode

        if not ReferralCode.objects.filter(code__iexact=code, is_deleted=False).exists():
            raise serializers.ValidationError("Referral code is invalid.")
        return code

    def create(self, validated_data):
        password = validated_data.pop("password")
        referral_code = validated_data.pop("referral_code", "")
        email = validated_data["email"].strip().lower()
        validated_data["email"] = email
        validated_data.setdefault("username", email)
        user = User(**validated_data)
        user.set_password(password)
        user.is_active = True
        user.email_verified = True
        user.email_verification_token = ""
        user.email_verification_sent_at = None
        user.save()
        Profile.objects.get_or_create(user=user)
        if referral_code:
            from billing.services import record_referral_signup

            record_referral_signup(user, referral_code)
        return user


class UserSerializer(serializers.ModelSerializer):
    business_code = serializers.SerializerMethodField()

    def get_business_code(self, obj):
        return f"VF-{obj.id}"

    def validate(self, attrs):
        currency = attrs.get("currency", getattr(self.instance, "currency", "ZAR"))
        enabled = attrs.get("enabled_currencies", getattr(self.instance, "enabled_currencies", [currency])) or [currency]
        normalized_enabled = []
        for code in enabled:
            code_str = str(code).strip().upper()
            if code_str and code_str not in normalized_enabled:
                normalized_enabled.append(code_str)
        if currency not in normalized_enabled:
            normalized_enabled.insert(0, currency)
        attrs["currency"] = currency
        attrs["enabled_currencies"] = normalized_enabled[:2]

        rates = attrs.get("exchange_rates", getattr(self.instance, "exchange_rates", {}) or {}) or {}
        normalized_rates = {}
        for key, value in rates.items():
            code = str(key).strip().upper()
            if not code or code == currency:
                continue
            try:
                normalized_rates[code] = float(value)
            except (TypeError, ValueError):
                raise serializers.ValidationError({"exchange_rates": f"Invalid exchange rate for {code}."})
        attrs["exchange_rates"] = normalized_rates
        return attrs

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "username",
            "phone",
            "business_name",
            "currency",
            "currency_symbol",
            "enabled_currencies",
            "exchange_rates",
            "dark_mode",
            "onboarding_complete",
            "email_verified",
            "business_code",
        ]
        read_only_fields = ["business_code"]


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False, min_length=8)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False, min_length=8)

    def validate_current_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "New passwords do not match."})

        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError({"new_password": "Choose a different password from your current one."})

        password_validation.validate_password(attrs["new_password"], self.context["request"].user)
        return attrs


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = "__all__"
        read_only_fields = ["user", "created_at", "updated_at"]


class StaffSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)
    temp_password = serializers.CharField(write_only=True, required=False, allow_blank=True, min_length=4)

    class Meta:
        model = Staff
        fields = "__all__"
        read_only_fields = ["user", "password", "created_at", "updated_at"]

    def validate_username(self, value):
        username = (value or "").strip().lower()
        if not username:
            return ""
        qs = Staff.objects.filter(user=self.context["request"].user, username__iexact=username, is_deleted=False)
        if self.instance:
            qs = qs.exclude(id=self.instance.id)
        if qs.exists():
            raise serializers.ValidationError("This staff username is already in use for your business.")
        return username

    def validate_permissions(self, value):
        if value is None:
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("Permissions must be a list.")
        return [str(item).strip() for item in value if str(item).strip()]

    def create(self, validated_data):
        temp_password = validated_data.pop("temp_password", "")
        staff = super().create(validated_data)
        if temp_password:
            staff.set_password(temp_password)
            staff.save(update_fields=["password"])
        return staff

    def update(self, instance, validated_data):
        temp_password = validated_data.pop("temp_password", "")
        staff = super().update(instance, validated_data)
        if temp_password:
            staff.set_password(temp_password)
            staff.save(update_fields=["password"])
        return staff


class StaffLoginSerializer(serializers.Serializer):
    business_code = serializers.CharField()
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        business_code = attrs["business_code"].strip()
        username = attrs["username"].strip().lower()
        password = attrs["password"]

        owner = None
        if business_code.upper().startswith("VF-"):
            try:
                owner_id = int(business_code.split("-", 1)[1])
                owner = User.objects.filter(id=owner_id, is_active=True).first()
            except (IndexError, TypeError, ValueError):
                owner = None
        if owner is None:
            owner = User.objects.filter(email__iexact=business_code, is_active=True).first()
        if owner is None:
            owner = User.objects.filter(business_name__iexact=business_code, is_active=True).first()
        if owner is None:
            raise serializers.ValidationError({"detail": "Business account not found."})

        staff = Staff.objects.filter(user=owner, username__iexact=username, is_deleted=False).first()
        if not staff or staff.status != Staff.ACTIVE or not staff.login_enabled or not staff.check_password(password):
            raise serializers.ValidationError({"detail": "Invalid staff username or password."})

        attrs["owner"] = owner
        attrs["staff"] = staff
        return attrs


class StaffActivityLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor.email", read_only=True, allow_null=True)

    class Meta:
        model = StaffActivityLog
        fields = ["id", "actor", "actor_email", "action", "object_type", "object_id", "summary", "metadata", "created_at"]
        read_only_fields = fields
