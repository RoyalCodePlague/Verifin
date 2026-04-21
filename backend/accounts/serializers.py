from django.contrib.auth import authenticate, get_user_model
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

    class Meta:
        model = User
        fields = ["id", "email", "password", "phone", "business_name"]

    def validate_email(self, value):
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def create(self, validated_data):
        password = validated_data.pop("password")
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
        return user


class UserSerializer(serializers.ModelSerializer):
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
        ]


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = "__all__"
        read_only_fields = ["user", "created_at", "updated_at"]


class StaffSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)

    class Meta:
        model = Staff
        fields = "__all__"
        read_only_fields = ["user", "created_at", "updated_at"]


class StaffActivityLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor.email", read_only=True, allow_null=True)

    class Meta:
        model = StaffActivityLog
        fields = ["id", "actor", "actor_email", "action", "object_type", "object_id", "summary", "metadata", "created_at"]
        read_only_fields = fields
