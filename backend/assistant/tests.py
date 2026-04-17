from django.test import TestCase, Client
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from .models import AssistantLog
from .services import GroqAssistantService

User = get_user_model()


class GroqAssistantServiceTest(TestCase):
    """Test cases for Groq Assistant Service"""

    def setUp(self):
        self.service = GroqAssistantService()

    def test_service_initialization(self):
        """Test that service initializes correctly"""
        self.assertIsNotNone(self.service.model)

    def test_system_prompt_generation(self):
        """Test that system prompt generates without errors"""
        prompt = self.service.build_system_prompt()
        self.assertIn("Verifin", prompt)
        self.assertIn("create_sale", prompt)

    def test_conversation_history_management(self):
        """Test conversation history tracking"""
        self.assertEqual(len(self.service.conversation_history), 0)
        self.service.clear_history()
        self.assertEqual(len(self.service.conversation_history), 0)


class AssistantAPITest(TestCase):
    """Test cases for Assistant API endpoints"""

    def setUp(self):
        # Create test user
        self.user = User.objects.create_user(
            email="test@example.com",
            password="testpass123",
        )

        # Setup API client with authentication
        self.client = APIClient()
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")

    def test_assistant_command_endpoint_structure(self):
        """Test that endpoint returns expected structure"""
        response = self.client.post(
            "/api/v1/assistant/command/",
            {"command": "test command"},
            format="json",
        )

        # Check structure even if Claude fails
        self.assertIn("parsed_action", response.data)
        self.assertIn("message", response.data)

    def test_assistant_command_without_authentication(self):
        """Test that endpoint requires authentication"""
        client = APIClient()
        response = client.post(
            "/api/v1/assistant/command/",
            {"command": "test command"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_assistant_command_missing_text(self):
        """Test that endpoint requires command text"""
        response = self.client.post(
            "/api/v1/assistant/command/",
            {"command": ""},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_assistant_history_endpoint(self):
        """Test history endpoint"""
        response = self.client.get("/api/v1/assistant/history/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("logs", response.data)

    def test_assistant_log_creation(self):
        """Test that assistant logs are created"""
        initial_count = AssistantLog.objects.count()

        response = self.client.post(
            "/api/v1/assistant/command/",
            {"command": "test command"},
            format="json",
        )

        # Check that log was created
        new_count = AssistantLog.objects.count()
        self.assertGreater(new_count, initial_count)


class AssistantLogModelTest(TestCase):
    """Test cases for AssistantLog model"""

    def setUp(self):
        self.user = User.objects.create_user(
            email="test@example.com",
            password="testpass123",
        )

    def test_assistant_log_creation(self):
        """Test creating an assistant log"""
        log = AssistantLog.objects.create(
            user=self.user,
            input_text="Test command",
            parsed_action="create_sale",
            result="Success",
            ai_response={"action": "create_sale", "confidence": 0.95},
            confidence=0.95,
        )

        self.assertEqual(log.user, self.user)
        self.assertEqual(log.parsed_action, "create_sale")
        self.assertEqual(log.confidence, 0.95)

    def test_assistant_log_ordering(self):
        """Test that logs are ordered by created_at descending"""
        log1 = AssistantLog.objects.create(
            user=self.user,
            input_text="Command 1",
            parsed_action="action1",
        )
        log2 = AssistantLog.objects.create(
            user=self.user,
            input_text="Command 2",
            parsed_action="action2",
        )

        logs = AssistantLog.objects.all()
        self.assertEqual(logs[0].id, log2.id)  # Most recent first


# Integration tests - uncomment when Claude API is ready
"""
class ClaudeIntegrationTest(TestCase):
    def test_parse_command_with_api(self):
        service = ClaudeAssistantService()
        result = service.parse_command("I sold 3 loaves for R45 each")
        
        self.assertIn("action", result)
        self.assertIn("confidence", result)
        self.assertIn("message", result)
"""

