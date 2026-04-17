#!/usr/bin/env python
import os
import sys
import django

# Add backend directory to path
sys.path.insert(0, os.path.dirname(__file__))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from assistant import views, services

print("✓ Assistant app properly configured")
print(f"✓ Services module: {services}")
print(f"✓ Views module: {views}")
"""
Groq AI Assistant Quick Start & Verification Script

Run this script to verify that Groq AI integration is properly set up.
Usage: python verify_groq_setup.py
"""

import os
import sys
import django

# Setup Django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from assistant.services import GroqAssistantService
from assistant.models import AssistantLog
import json

User = get_user_model()

print("=" * 80)
print("Groq AI Assistant Setup Verification")
print("=" * 80)

# ============================================================================
# Check 1: Environment Configuration
# ============================================================================
print("\n[1/4] Checking Environment Configuration...")
print("-" * 80)

api_key = settings.GROQ_API_KEY
model = settings.GROQ_MODEL

if not api_key:
    print("❌ GROQ_API_KEY not found in settings")
    print("   FIX: Add GROQ_API_KEY to your .env file")
    sys.exit(1)
else:
    masked_key = api_key[:10] + "..." + api_key[-5:] if len(api_key) > 15 else "***"
    print(f"✓ GROQ_API_KEY configured: {masked_key}")

if not model:
    print("❌ GROQ_MODEL not found in settings")
    sys.exit(1)
else:
    print(f"✓ GROQ_MODEL: {model}")

# ============================================================================
# Check 2: Service Initialization
# ============================================================================
print("\n[2/4] Checking Groq Service...")
print("-" * 80)

try:
    service = GroqAssistantService()
    print("✓ GroqAssistantService initialized successfully")
    print(f"  - Model: {service.model}")
    print(f"  - Conversation history: {len(service.conversation_history)} messages")
except Exception as e:
    print(f"❌ Failed to initialize GroqAssistantService: {str(e)}")
    sys.exit(1)

# ============================================================================
# Check 3: Database Models
# ============================================================================
print("\n[3/4] Checking Database Models...")
print("-" * 80)

try:
    log_count = AssistantLog.objects.count()
    print(f"✓ AssistantLog model is accessible")
    print(f"  - Current logs in database: {log_count}")

    # Check model fields
    from assistant.models import AssistantLog as LogModel
    required_fields = [
        "user",
        "input_text",
        "parsed_action",
        "ai_response",
        "confidence",
        "requires_confirmation",
        "executed",
    ]

    fields = [f.name for f in LogModel._meta.fields]
    missing_fields = [f for f in required_fields if f not in fields]

    if missing_fields:
        print(f"❌ Missing fields in AssistantLog: {missing_fields}")
        print("   FIX: Run migrations: python manage.py migrate assistant")
        sys.exit(1)
    else:
        print(f"✓ All required fields present in AssistantLog")

except Exception as e:
    print(f"❌ Error checking models: {str(e)}")
    sys.exit(1)

# ============================================================================
# Check 4: API Connectivity
# ============================================================================
print("\n[4/4] Testing Groq API Connectivity...")
print("-" * 80)

try:
    print("Sending test command to Groq...")
    test_command = "I sold 5 bread for 50 rand to John"
    response = service.parse_command(test_command)

    if response.get("action") != "error":
        print("✓ Successfully connected to Groq API")
        print(f"  - Parsed action: {response.get('action')}")
        print(f"  - Confidence: {response.get('confidence', 0):.2f}")
        print(f"  - Message: {response.get('message', '')[:60]}...")

        # Try to parse as JSON
        if isinstance(response, dict):
            print("✓ Response is valid JSON")
        else:
            print(f"⚠ Response format: {type(response)}")
    else:
        error_msg = response.get("message", "Unknown error")
        print(f"❌ Groq API error: {error_msg}")

        if "API key" in error_msg:
            print("   FIX: Verify your GROQ_API_KEY in .env file")
        elif "connection" in error_msg.lower():
            print("   FIX: Check your internet connection")
        else:
            print("   Consider checking Groq API status")

except Exception as e:
    print(f"⚠ Could not connect to Groq API: {str(e)}")
    print("  This might be normal if:")
    print("  - You don't have internet connection")
    print("  - The API key is invalid")
    print("  - Groq API is experiencing issues")

# ============================================================================
# Summary
# ============================================================================
print("\n" + "=" * 80)
print("Setup Verification Complete!")
print("=" * 80)

print("\nNext Steps:")
print("1. Create a test user:")
print("   python manage.py shell")
print("   >>> from django.contrib.auth import get_user_model")
print("   >>> User = get_user_model()")
print("   >>> user = User.objects.create_user('test@example.com', 'password')")
print()
print("2. Test the API endpoint:")
print("   python manage.py runserver")
print("   curl -X POST http://localhost:8000/api/v1/assistant/command/ \\")
print("     -H 'Content-Type: application/json' \\")
print("     -H 'Authorization: Bearer YOUR_JWT_TOKEN' \\")
print("     -d '{\"command\": \"I sold 5 loaves for R50\"}'")
print()
print("3. Monitor logs in Django admin:")
print("   http://localhost:8000/admin/assistant/assistantlog/")
print()
print("Resources:")
print("- Setup Guide: backend/CLAUDE_SETUP.md")
print("- Frontend Guide: backend/CLAUDE_FRONTEND.md")
print("- Examples: backend/assistant/examples.py")
print("- Groq API Docs: https://console.groq.com/docs")
print()
print("=" * 80)
