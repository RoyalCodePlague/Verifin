"""
Claude AI Assistant Integration Examples

This file shows how to use the Claude AI assistant in your Verifin backend.
"""

# ============================================================================
# EXAMPLE 1: Using the Assistant Service Directly
# ============================================================================

from assistant.services import ClaudeAssistantService

# Initialize the service
service = ClaudeAssistantService()

# Parse a command
command = "I sold 3 loaves of bread for R45 each to John"
response = service.parse_command(command)

print(response)
# {
#   "action": "create_sale",
#   "confidence": 0.95,
#   "data": {
#     "product": "loaves of bread",
#     "quantity": 3,
#     "unit_price": 45.0,
#     "customer": "John",
#     "total": 135.0
#   },
#   "message": "I'll create a sale for 3 loaves of bread at R45 each",
#   "requires_confirmation": False
# }

# Execute the action if needed
if response.get("action") != "error" and response.get("confidence", 0) > 0.7:
    result = service.execute_action(response)
    print(result)


# ============================================================================
# EXAMPLE 2: Using in Django Views (API)
# ============================================================================

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from assistant.services import ClaudeAssistantService

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def custom_assistant_endpoint(request):
    command = request.data.get("command")
    service = ClaudeAssistantService()
    response = service.parse_command(command, user=request.user)
    return Response(response)


# ============================================================================
# EXAMPLE 3: Custom Business Logic with Claude
# ============================================================================

from assistant.models import AssistantLog
from inventory.models import Product
from sales.models import Sale, SaleItem
from customers.models import Customer
from decimal import Decimal

class BusinessLogicExecutor:
    """Execute actual business logic based on Claude's parsed commands"""

    def execute_sale_creation(self, data, user):
        """Create a sale from parsed data"""
        try:
            product_name = data.get("product")
            quantity = data.get("quantity", 0)
            unit_price = data.get("unit_price", 0)
            customer_name = data.get("customer")

            # Get product
            product = Product.objects.get(name__icontains=product_name)

            # Check stock
            if product.stock < quantity:
                return {
                    "status": "error",
                    "message": f"Insufficient stock. Available: {product.stock}, Requested: {quantity}"
                }

            # Get or create customer
            customer = None
            if customer_name:
                customer, _ = Customer.objects.get_or_create(
                    name=customer_name,
                    defaults={"phone": ""}
                )

            # Create sale
            total = Decimal(str(quantity * unit_price))
            sale = Sale.objects.create(
                total=total,
                payment_method="Cash",
                customer=customer,
                created_by=user,
            )

            # Create sale items
            SaleItem.objects.create(
                sale=sale,
                product=product,
                quantity=quantity,
                unit_price=Decimal(str(unit_price)),
                subtotal=total,
            )

            # Update product stock
            product.stock -= quantity
            product.save()

            return {
                "status": "success",
                "message": f"Sale created: {quantity} {product.name} for R{total}",
                "sale_id": sale.id,
            }

        except Product.DoesNotExist:
            return {
                "status": "error",
                "message": f"Product not found: {data.get('product')}"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error creating sale: {str(e)}"
            }


# ============================================================================
# EXAMPLE 4: Using Conversation Context
# ============================================================================

# Claude maintains conversation history for context
service = ClaudeAssistantService()

# First command
response1 = service.parse_command("I sold 3 loaves today")
print(response1["message"])

# Follow-up command with context
response2 = service.parse_command("How much revenue was that?")
print(response2["message"])
# Claude remembers the previous context about loaves

# Clear history if needed
service.clear_history()


# ============================================================================
# EXAMPLE 5: Batch Processing Commands
# ============================================================================

from django.contrib.auth import get_user_model

User = get_user_model()

# Process multiple commands from a user
commands = [
    "I sold 5 eggs for R100",
    "I spent R50 on transport",
    "Restock 24 Coca-Cola cans",
]

service = ClaudeAssistantService()
user = User.objects.first()

for command in commands:
    response = service.parse_command(command, user=user)
    log = AssistantLog.objects.create(
        user=user,
        input_text=command,
        parsed_action=response.get("action"),
        result=response.get("message"),
        ai_response=response,
        confidence=response.get("confidence", 0),
    )
    print(f"✓ Processed: {command} -> {response.get('action')}")


# ============================================================================
# EXAMPLE 6: Production Best Practices
# ============================================================================

import logging
from django.conf import settings

logger = logging.getLogger(__name__)

class SafeAssistantExecutor:
    """Production-ready executor with error handling"""

    def execute_safely(self, command, user):
        try:
            if not settings.CLAUDE_API_KEY:
                logger.error("Claude API key not configured")
                return {"status": "error", "message": "AI assistant not configured"}

            service = ClaudeAssistantService()
            response = service.parse_command(command, user=user)

            # Validate response
            if not isinstance(response, dict):
                logger.error(f"Invalid response format: {response}")
                return {"status": "error", "message": "Invalid response from AI"}

            # Check confidence
            if response.get("confidence", 0) < 0.5:
                logger.warning(f"Low confidence: {response.get('confidence')}")
                response["requires_confirmation"] = True

            # Log for audit trail
            AssistantLog.objects.create(
                user=user,
                input_text=command,
                parsed_action=response.get("action", "unknown"),
                ai_response=response,
                confidence=response.get("confidence", 0),
            )

            return response

        except Exception as e:
            logger.exception(f"Error executing assistant command: {str(e)}")
            return {
                "status": "error",
                "message": "An error occurred processing your command",
                "action": "error"
            }


# ============================================================================
# EXAMPLE 7: Custom System Prompt per User Type
# ============================================================================

class CustomAssistantService(ClaudeAssistantService):
    """Extend Claude assistant with custom prompts"""

    def build_system_prompt(self, user=None):
        base_prompt = super().build_system_prompt(user)

        if user and user.get_role() == "cashier":
            # Cashiers only need sales-related commands
            return base_prompt + """
            
            IMPORTANT FOR CASHIERS:
            - Focus on sales recording
            - Customer credit/debit
            - Quick stock lookups
            - Block inventory restocking commands
            """

        elif user and user.get_role() == "stock_manager":
            # Stock managers focus on inventory
            return base_prompt + """
            
            IMPORTANT FOR STOCK MANAGERS:
            - Focus on inventory management
            - Stock movements
            - Reordering
            - Audit operations
            - Block sales commands
            """

        return base_prompt


# ============================================================================
# TESTING
# ============================================================================

"""
To test Claude integration without an API key:

1. Set up .env with a valid CLAUDE_API_KEY

2. Run Django shell:
   python manage.py shell

3. Test:
   from assistant.examples import *
   service = ClaudeAssistantService()
   result = service.parse_command("I sold 10 bread for 50 rand")
   print(result)

4. Run tests:
   python manage.py test assistant

5. Check logs in Django admin:
   /admin/assistant/assistantlog/
"""
