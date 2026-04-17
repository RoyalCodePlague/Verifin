#!/usr/bin/env python
"""
Test script for Groq AI Assistant API

Run this to test the endpoint without the frontend.
Usage: python test_assistant_api.py
"""

import os
import sys
import django
import json

# Setup Django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model
from django.test import Client
from rest_framework_simplejwt.tokens import RefreshToken


def get_tokens_for_user(user):
    """Generate JWT tokens for a user"""
    refresh = RefreshToken.for_user(user)
    return {
        'refresh': str(refresh),
        'access': str(refresh.access_token),
    }


def test_assistant_api():
    """Test the assistant API endpoint"""
    print("=" * 80)
    print("Testing Groq AI Assistant API")
    print("=" * 80)

    User = get_user_model()
    
    # Create or get test user
    user, created = User.objects.get_or_create(
        email='testapi@example.com',
        defaults={
            'username': 'testapi',
            'business_name': 'Test Business',
        }
    )
    
    if created:
        user.set_password('testpass123')
        user.save()
        print(f"✓ Created test user: {user.email}")
    else:
        print(f"✓ Using existing test user: {user.email}")

    # Get JWT token
    tokens = get_tokens_for_user(user)
    access_token = tokens['access']
    
    print(f"✓ Generated access token: {access_token[:30]}...\n")

    # Create Django test client
    client = Client()

    # Test commands
    test_commands = [
        "Add 30 apples",
        "I sold 5 apples for 100",
        "Spent 200 on transport",
    ]

    for i, command in enumerate(test_commands, 1):
        print("-" * 80)
        print(f"[Test {i}] Command: {command}")
        print("-" * 80)
        
        response = client.post(
            '/api/v1/assistant/command/',
            data=json.dumps({'command': command}),
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {access_token}',
        )

        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Success!")
            print(f"  - Action: {data.get('parsed_action')}")
            print(f"  - Confidence: {data.get('confidence', 0):.2f}")
            print(f"  - Message: {data.get('message', '')[:100]}...")
            
            if data.get('execution_result'):
                exec_result = data['execution_result']
                if 'data' in exec_result:
                    print(f"  - Execution Data: {exec_result['data']}")
        else:
            print(f"❌ Error!")
            print(f"Response: {response.json()}")
        
        print()

    print("=" * 80)
    print("Test Complete!")
    print("=" * 80)


if __name__ == '__main__':
    try:
        test_assistant_api()
    except Exception as e:
        print(f"❌ Test failed with error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
