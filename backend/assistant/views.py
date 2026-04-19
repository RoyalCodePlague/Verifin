import logging
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from .models import AssistantLog
import json
import logging
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from groq import Groq
from . import services
from billing.services import enforce_feature
logger = logging.getLogger(__name__)
@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def command_endpoint(request):
    """Process user command with Groq (compatible with frontend)"""
    enforce_feature(request.user, "ai_assistant")
    user_command = request.data.get('command', '').strip()
    if not user_command:
        return Response({"error": "No command provided"}, status=400)
    
    try:
        from groq import Groq
        from django.conf import settings
        
        client = Groq(api_key=settings.GROQ_API_KEY)
        response = client.chat.completions.create(
            model=getattr(settings, 'GROQ_MODEL', 'mixtral-8x7b-32768'),
            messages=[
                {"role": "system", "content": services.SYSTEM_PROMPT},
                {"role": "user", "content": user_command}
            ],
            temperature=getattr(settings, 'GROQ_TEMPERATURE', 0.3),
            max_tokens=getattr(settings, 'GROQ_MAX_TOKENS', 1024)
        )
        
        raw_response = response.choices[0].message.content
        parsed = services.parse_and_clean_groq_response(raw_response)
        
        action = parsed.get('action', '')
        data = {}
        
        # Execute action and fetch/create data
        if action == 'query_stock':
            data = services.query_stock()
        elif action == 'query_expenses':
            data = services.query_expenses()
        elif action == 'query_sales':
            data = services.query_sales()
        elif action == 'query_customers':
            data = services.query_customers()
        elif action == 'generate_insights':
            data = services.generate_insights()
        elif action == 'create_product':
            # Create new product
            product_data = parsed.get('data', {})
            data = services.create_product(
                product_name=product_data.get('product_name', 'Unknown Product'),
                quantity=int(product_data.get('quantity', 0)),
                price=float(product_data.get('price', 0.0)),
                sku=product_data.get('sku')
            )
        elif action == 'restock_product':
            # Add to existing product stock
            product_data = parsed.get('data', {})
            from inventory.models import Product
            try:
                product = Product.objects.filter(
                    name__icontains=product_data.get('product_name', '')
                ).first()
                if product:
                    new_qty = int(product_data.get('quantity', 0))
                    product.stock += new_qty
                    product.save()
                    data = {
                        "id": product.id,
                        "name": product.name,
                        "stock": product.stock,
                        "message": f"✅ Restocked {new_qty} units of {product.name}"
                    }
                else:
                    # Product doesn't exist, create it
                    data = services.create_product(
                        product_name=product_data.get('product_name', 'Unknown'),
                        quantity=int(product_data.get('quantity', 0)),
                        price=float(product_data.get('price', 0.0))
                    )
            except Exception as e:
                data = {"error": str(e), "message": f"Failed to restock: {str(e)}"}
        elif action == 'create_sale' or action == 'record_sale':
            # Record a sale
            sale_data = parsed.get('data', {})
            data = services.record_sale_action(
                product_name=sale_data.get('product', sale_data.get('product_name', '')) or 'Unknown',
                quantity=int(sale_data.get('quantity', 1)),
                price_per_unit=float(sale_data.get('price', sale_data.get('unit_price', 0))),
                customer_name=sale_data.get('customer')
            )
        elif action == 'create_expense' or action == 'log_expense':
            # Log an expense
            expense_data = parsed.get('data', {})
            data = services.log_expense_action(
                description=expense_data.get('description', expense_data.get('name', 'Expense')),
                amount=float(expense_data.get('amount', 0)),
                category=expense_data.get('category', 'General')
            )
        
        # Return in format expected by frontend
        return Response({
            "parsed_action": action,
            "confidence": parsed.get('confidence', 0.5),
            "message": parsed.get('message', '') or data.get('message', ''),
            "requires_confirmation": parsed.get('requires_confirmation', False),
            "execution_result": {"data": data}
        })
    except Exception as e:
        logger.exception(f"Command error: {e}")
        return Response({"error": str(e), "parsed_action": "error"}, status=500)

@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def chat_endpoint(request):
    """Process user message with Groq and fetch real data"""
    enforce_feature(request.user, "ai_assistant")
    user_message = request.data.get('message', '').strip()
    if not user_message:
        return Response({"error": "No message provided"}, status=400)
    
    try:
        from groq import Groq
        from django.conf import settings
        
        client = Groq(api_key=settings.GROQ_API_KEY)
        response = client.chat.completions.create(
            model=getattr(settings, 'GROQ_MODEL', 'mixtral-8x7b-32768'),
            messages=[
                {"role": "system", "content": services.SYSTEM_PROMPT},
                {"role": "user", "content": user_message}
            ],
            temperature=getattr(settings, 'GROQ_TEMPERATURE', 0.3),
            max_tokens=getattr(settings, 'GROQ_MAX_TOKENS', 1024)
        )
        
        raw_response = response.choices[0].message.content
        parsed = services.parse_and_clean_groq_response(raw_response)
        
        action = parsed.get('action', '')
        if action == 'query_stock':
            parsed['data'] = services.query_stock()
        elif action == 'query_expenses':
            parsed['data'] = services.query_expenses()
        elif action == 'query_sales':
            parsed['data'] = services.query_sales()
        elif action == 'query_customers':
            parsed['data'] = services.query_customers()
        elif action == 'generate_insights':
            parsed['data'] = services.generate_insights()
        
        return Response(parsed)
    except Exception as e:
        logger.exception(f"Chat error: {e}")
        return Response({"error": str(e)}, status=500)

@api_view(['GET'])
@csrf_exempt
@permission_classes([IsAuthenticated])
def insights_endpoint(request):
    """AI Insights endpoint"""
    enforce_feature(request.user, "advanced_analytics")
    try:
        insights = services.generate_insights()
        return Response(insights)
    except Exception as e:
        return Response({"error": str(e), "insights": []}, status=500)

@api_view(['GET'])
@csrf_exempt
def live_activity_endpoint(request):
    """Live activity metrics"""
    try:
        stock = services.query_stock()
        expenses = services.query_expenses()
        sales = services.query_sales()
        return Response({
            "inventory": {"items": stock.get('total_items', 0), "qty": stock.get('total_quantity', 0)},
            "expenses": {"total": expenses.get('total_cost', 0)},
            "sales": {"revenue": sales.get('total_revenue', 0)}
        })
    except Exception as e:
        return Response({"error": str(e)}, status=500)

logger = logging.getLogger(__name__)


class AssistantCommandView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """
        Handle natural language assistant commands using Claude AI

        Expected request body:
        {
            "command": "Sold 3 loaves of bread for R45 each"
        }
        """
        try:
            enforce_feature(request.user, "ai_assistant")
            command_text = request.data.get("command", "").strip()

            if not command_text:
                return Response(
                    {"error": "Command text is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Initialize Groq service
            groq_service = GroqAssistantService()

            # Parse command using Groq
            parsed_response = groq_service.parse_command(command_text, user=request.user)

            # Log the interaction
            log_entry = AssistantLog.objects.create(
                user=request.user,
                input_text=command_text,
                parsed_action=parsed_response.get("action", "unknown"),
                result=parsed_response.get("message", ""),
                ai_response=parsed_response,
                confidence=parsed_response.get("confidence", 0.0),
                requires_confirmation=parsed_response.get("requires_confirmation", False),
            )

            # Execute the action if confidence is high and no confirmation needed
            if (
                parsed_response.get("action") != "error"
                and parsed_response.get("confidence", 0) > 0.7
                and not parsed_response.get("requires_confirmation", False)
            ):
                execution_result = groq_service.execute_action(parsed_response, user=request.user)
                log_entry.executed = True
                log_entry.save()
            else:
                execution_result = {
                    "status": "pending_confirmation",
                    "message": "Action requires user confirmation before execution",
                    "action": parsed_response.get("action"),
                    "data": parsed_response.get("data", {}),
                }

            return Response(
                {
                    "id": log_entry.id,
                    "command": command_text,
                    "parsed_action": parsed_response.get("action"),
                    "confidence": parsed_response.get("confidence", 0.0),
                    "message": parsed_response.get("message", ""),
                    "requires_confirmation": parsed_response.get("requires_confirmation", False),
                    "execution_result": execution_result,
                    "next_steps": execution_result.get("next_steps", []),
                },
                status=status.HTTP_200_OK,
            )

        except Exception as e:
            logger.error(f"Error in assistant command: {str(e)}", exc_info=True)
            return Response(
                {"error": f"Error processing command: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class AssistantHistoryView(APIView):
    """Get user's assistant command history"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Get assistant logs for the authenticated user"""
        limit = int(request.query_params.get("limit", 10))
        logs = AssistantLog.objects.filter(user=request.user)[:limit]

        data = [
            {
                "id": log.id,
                "command": log.input_text,
                "action": log.parsed_action,
                "confidence": log.confidence,
                "executed": log.executed,
                "requires_confirmation": log.requires_confirmation,
                "created_at": log.created_at,
                "result": log.result,
            }
            for log in logs
        ]

        return Response({"logs": data}, status=status.HTTP_200_OK)


class AssistantConfirmActionView(APIView):
    """Confirm and execute a pending action"""

    permission_classes = [IsAuthenticated]

    def post(self, request, log_id):
        """
        Confirm and execute a pending assistant action

        Expected request body:
        {
            "confirmed": true
        }
        """
        try:
            log_entry = AssistantLog.objects.get(id=log_id, user=request.user)

            if log_entry.executed:
                return Response(
                    {"error": "Action has already been executed"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            confirmed = request.data.get("confirmed", False)

            if confirmed:
                groq_service = GroqAssistantService()
                execution_result = groq_service.execute_action(log_entry.ai_response, user=request.user)
                log_entry.executed = True
                log_entry.save()

                return Response(
                    {
                        "status": "success",
                        "message": "Action executed successfully",
                        "execution_result": execution_result,
                    },
                    status=status.HTTP_200_OK,
                )
            else:
                log_entry.delete()
                return Response(
                    {"status": "cancelled", "message": "Action cancelled"},
                    status=status.HTTP_200_OK,
                )

        except AssistantLog.DoesNotExist:
            return Response(
                {"error": "Log entry not found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            logger.error(f"Error confirming action: {str(e)}", exc_info=True)
            return Response(
                {"error": f"Error confirming action: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

