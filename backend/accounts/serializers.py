from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
import secrets
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import Profile, Staff

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
        if existing_user and (not existing_user.email_verified or not existing_user.is_active):
            raise serializers.ValidationError({
                'detail': 'Please verify your email before signing in.'
            })

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

    def validate_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        email = validated_data["email"]
        validated_data["email"] = email
        validated_data.setdefault("username", email)
        user = User(**validated_data)
        user.set_password(password)
        user.is_active = False
        user.email_verified = False
        user.email_verification_token = secrets.token_urlsafe(32)
        user.email_verification_sent_at = timezone.now()
        user.save()
        Profile.objects.get_or_create(user=user)
        return user


class UserSerializer(serializers.ModelSerializer):
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
