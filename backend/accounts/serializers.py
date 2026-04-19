from django.contrib.auth import authenticate, get_user_model
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
        email = attrs.get('email')
        password = attrs.get('password')
        
        if not email or not password:
            raise serializers.ValidationError({
                'detail': 'Email and password are required.'
            })
        
        # Authenticate using email and password
        user = authenticate(username=email, password=password)
        
        if user is None:
            # Check if user exists
            if not User.objects.filter(email=email).exists():
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

    def create(self, validated_data):
        password = validated_data.pop("password")
        email = validated_data["email"]
        validated_data.setdefault("username", email)
        user = User(**validated_data)
        user.set_password(password)
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
