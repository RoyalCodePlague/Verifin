import json
import logging
import re
from datetime import datetime, timedelta, timezone
from groq import Groq
from django.conf import settings
from django.db.models import Sum
from inventory.models import Product, Category

logger = logging.getLogger(__name__)

# Initialize Groq client
try:
    client = Groq(api_key=settings.GROQ_API_KEY)
except Exception as e:
    logger.error(f"Failed to initialize Groq client: {e}")
    client = None

# System prompt for Groq
SYSTEM_PROMPT = """You are an AI assistant for Verifin, a business operating system for African SMEs (small and medium enterprises). 
You help shop owners manage their business through natural language commands.

You can help with:
1. Recording sales: e.g., "I sold 3 loaves of bread for R45 each to John"
2. Logging expenses: e.g., "I spent R200 on transport today"
3. Restocking inventory: e.g., "I restocked 24 Coca-Cola cans" or "Add 25 iphones"
4. Querying sales data: e.g., "How much did I earn today?" or "What were my sales this week?"
5. Stock queries: e.g., "What products are low on stock?"
6. Customer management: e.g., "Add R100 credit to customer John's account"

When a user gives you a command:
1. Parse the intent clearly
2. Extract relevant data (amounts, product names, customer names, dates, etc.)
3. Return a JSON response with the action type and parameters
4. Always validate numeric values and product names
5. For new products, include a reasonable price estimate (required for auto-creation)
6. Ask for clarification if information is missing

IMPORTANT: Always respond with ONLY a valid JSON object in this exact format:
{
    "action": "action_type",
    "confidence": 0.0-1.0,
    "data": {...relevant_data...},
    "message": "Human-readable response",
    "requires_confirmation": false
}

Valid action types: query_stock, query_expenses, query_sales, query_customers, generate_insights, record_sale, log_expense, restock_product, create_product, create_sale, create_expense

Do NOT wrap your response in markdown code blocks. Return plain JSON only."""

def parse_and_clean_groq_response(raw_content: str) -> dict:
    """
    Parse and clean Groq response, handling markdown code blocks.
    Groq sometimes wraps JSON in  ``` ... ``` despite instructions.
    """
    cleaned = raw_content.strip()
    
    # Remove markdown code blocks if present
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```\s*$", "", cleaned)
    
    cleaned = cleaned.strip()
    logger.debug(f"Cleaned Groq response: {cleaned}")
    
    return json.loads(cleaned)

def query_stock(filters: dict = None) -> dict:
    """Get real inventory data from Product model"""
    try:
        from inventory.models import Product
        
        products = Product.objects.all()
        if filters:
            products = products.filter(**filters)
        
        products_data = list(products.values('id', 'name', 'stock', 'sku', 'price'))
        total_qty = sum(p['stock'] for p in products_data)
        
        return {
            "products": products_data,
            "total_items": len(products_data),
            "total_quantity": total_qty,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error querying stock: {e}")
        return {"error": str(e), "products": [], "total_quantity": 0}

def query_expenses(filters: dict = None) -> dict:
    """Get real expense data"""
    try:
        from expenses.models import Expense
        
        expenses = Expense.objects.all()
        if filters:
            expenses = expenses.filter(**filters)
        
        expenses_data = list(expenses.values('id', 'category', 'amount', 'date'))
        total = sum(e['amount'] for e in expenses_data)
        
        return {
            "expenses": expenses_data,
            "total_cost": total,
            "count": len(expenses_data),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error querying expenses: {e}")
        return {"error": str(e), "expenses": [], "total_cost": 0}

def query_sales(filters: dict = None) -> dict:
    """Get real sales data"""
    try:
        from sales.models import Sale, SaleItem
        
        sales = Sale.objects.all()
        if filters:
            sales = sales.filter(**filters)
        
        # Get sales summary
        sales_data = list(sales.values('id', 'total', 'date', 'payment_method'))
        total_revenue = sales.aggregate(Sum('total'))['total__sum'] or 0
        
        # Get detailed items from SaleItem
        sale_items = SaleItem.objects.filter(sale__in=sales).values(
            'id', 'product__name', 'quantity', 'unit_price', 'subtotal'
        )
        
        return {
            "sales": sales_data,
            "items": list(sale_items),
            "total_revenue": float(total_revenue) if total_revenue else 0,
            "count": len(sales_data),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error querying sales: {e}")
        return {"error": str(e), "sales": [], "total_revenue": 0}

def query_customers(filters: dict = None) -> dict:
    """Get real customer data"""
    try:
        from customers.models import Customer
        
        customers = Customer.objects.all()
        if filters:
            customers = customers.filter(**filters)
        
        customers_data = list(customers.values('id', 'name', 'email', 'phone', 'created_at'))
        
        return {
            "customers": customers_data,
            "total_customers": len(customers_data),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error querying customers: {e}")
        return {"error": str(e), "customers": [], "total_customers": 0}

def generate_insights() -> dict:
    """Generate business insights using AI"""
    insights = []
    
    try:
        # Low stock alert
        from inventory.models import Product
        low_stock = Product.objects.filter(stock__lt=10).count()
        if low_stock > 0:
            insights.append({
                "type": "low_stock_alert",
                "severity": "warning",
                "message": f"{low_stock} products have low stock levels"
            })
    except Exception as e:
        logger.error(f"Error getting low stock alert: {e}")
    
    try:
        # Sales trend
        from sales.models import Sale
        
        week_ago = datetime.now(timezone.utc) - timedelta(days=7)
        recent_sales = Sale.objects.filter(date__gte=week_ago).aggregate(total=Sum('total'))
        if recent_sales['total']:
            insights.append({
                "type": "sales_trend",
                "severity": "info",
                "message": f"Sales this week: ${recent_sales['total']}"
            })
    except Exception as e:
        logger.error(f"Error getting sales trend: {e}")
    
    return {
        "insights": insights,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

def create_product(product_name: str, quantity: int = 0, price: float = 0.0, sku: str = None) -> dict:
    """Create a new product in inventory"""
    try:
        from inventory.models import Product
        from django.contrib.auth.models import User
        
        # Get first user or create default user
        user = User.objects.first()
        if not user:
            user = User.objects.create_user(username='admin', email='admin@example.com')
        
        # Generate SKU if not provided
        if not sku:
            sku = f"SKU{Product.objects.count() + 1:04d}"
        
        product = Product.objects.create(
            user=user,
            name=product_name,
            sku=sku,
            stock=int(quantity),
            price=float(price),
            status="ok" if quantity > 0 else "out"
        )
        
        return {
            "id": product.id,
            "name": product.name,
            "sku": product.sku,
            "stock": product.stock,
            "price": float(product.price),
            "message": f"✅ Added {quantity} units of '{product_name}' at R{price:.2f} each"
        }
    except Exception as e:
        logger.error(f"Error creating product: {e}")
        return {"error": str(e), "message": f"Failed to add product: {str(e)}"}

def record_sale_action(product_name: str, quantity: int, price_per_unit: float, customer_name: str = None) -> dict:
    """Record a sale transaction"""
    try:
        from sales.models import Sale, SaleItem
        from inventory.models import Product
        from customers.models import Customer
        from django.contrib.auth.models import User
        
        user = User.objects.first()
        if not user:
            user = User.objects.create_user(username='admin', email='admin@example.com')
        
        # Find or create product
        product = Product.objects.filter(name__icontains=product_name).first()
        if not product:
            product = Product.objects.create(
                user=user,
                name=product_name,
                sku=f"SKU{Product.objects.count() + 1:04d}",
                stock=0,
                price=price_per_unit
            )
        
        # Find or create customer
        customer = None
        if customer_name:
            customer, _ = Customer.objects.get_or_create(
                user=user,
                name=customer_name,
                defaults={'email': f'{customer_name.lower().replace(" ", "")}@customer.local'}
            )
        
        total = quantity * price_per_unit
        sale = Sale.objects.create(
            user=user,
            customer=customer,
            total=total,
            payment_method="Cash"
        )
        
        # Create sale item
        SaleItem.objects.create(
            sale=sale,
            product=product,
            quantity=quantity,
            unit_price=price_per_unit,
            subtotal=total
        )
        
        # Update product stock
        product.stock = max(0, product.stock - quantity)
        product.save()
        
        return {
            "sale_id": sale.id,
            "product": product_name,
            "quantity": quantity,
            "total": total,
            "customer": customer_name or "Walk-in",
            "message": f"💰 Recorded sale: {quantity}x {product_name} for R{total:.2f}"
        }
    except Exception as e:
        logger.error(f"Error recording sale: {e}")
        return {"error": str(e), "message": f"Failed to record sale: {str(e)}"}

def log_expense_action(description: str, amount: float, category: str = "General") -> dict:
    """Log an expense transaction"""
    try:
        from expenses.models import Expense
        from django.contrib.auth.models import User
        
        user = User.objects.first()
        if not user:
            user = User.objects.create_user(username='admin', email='admin@example.com')
        
        expense = Expense.objects.create(
            user=user,
            name=description,
            amount=amount,
            category=category or "General"
        )
        
        return {
            "expense_id": expense.id,
            "description": description,
            "amount": amount,
            "category": category,
            "message": f"💸 Logged expense: R{amount:.2f} for {description}"
        }
    except Exception as e:
        logger.error(f"Error logging expense: {e}")
        return {"error": str(e), "message": f"Failed to log expense: {str(e)}"}


class GroqAssistantService:
    """Service for handling Groq AI-powered assistant commands"""

    def __init__(self):
        self.client = Groq(api_key=settings.GROQ_API_KEY)
        self.model = settings.GROQ_MODEL
        self.conversation_history = []

    def build_system_prompt(self, user=None):
        """Build the system prompt for Groq with business context"""
        system_prompt = """You are an AI assistant for Verifin, a business operating system for African SMEs (small and medium enterprises). 
        You help shop owners manage their business through natural language commands.

        You can help with:
        1. Recording sales: e.g., "I sold 3 loaves of bread for R45 each to John"
        2. Logging expenses: e.g., "I spent R200 on transport today"
        3. Restocking inventory: e.g., "I restocked 24 Coca-Cola cans" or "Add 25 iphones"
        4. Querying sales data: e.g., "How much did I earn today?" or "What were my sales this week?"
        5. Stock queries: e.g., "What products are low on stock?"
        6. Customer management: e.g., "Add R100 credit to customer John's account"

        When a user gives you a command:
        1. Parse the intent clearly
        2. Extract relevant data (amounts, product names, customer names, dates, etc.)
        3. Return a JSON response with the action type and parameters
        4. Always validate numeric values and product names
        5. For new products, include a reasonable price estimate (required for auto-creation)
        6. Ask for clarification if information is missing

        IMPORTANT: Always respond with a JSON object in this format:
        {
            "action": "action_type",
            "confidence": 0.0-1.0,
            "data": {...relevant_data...},
            "message": "Human-readable response",
            "requires_confirmation": true/false
        }

        For restock_product, include this data:
        {
            "product": "product_name",
            "quantity": number,
            "price": estimated_unit_price
        }

        Supported action types:
        - create_sale
        - create_expense
        - restock_product
        - query_sales
        - query_stock
        - query_customer
        - add_customer_credit
        - get_daily_summary
        - get_low_stock_alert
        - unknown
        """
        return system_prompt

    def parse_command(self, command_text, user=None):
        """Parse a natural language command using Groq"""
        try:
            if not settings.GROQ_API_KEY:
                return {
                    "action": "error",
                    "message": "Groq API key not configured. Set GROQ_API_KEY environment variable.",
                    "confidence": 0,
                }

            # Add user message to history
            self.conversation_history.append({"role": "user", "content": command_text})

            # Prepare messages for API call
            messages = [
                {"role": "system", "content": self.build_system_prompt(user)},
            ]
            messages.extend(self.conversation_history)

            # Create message with Groq
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=1024,
                temperature=0.7,
            )

            # Extract response content
            assistant_message = response.choices[0].message.content
            logger.info(f"Groq response: {assistant_message}")

            # Add assistant response to history
            self.conversation_history.append({"role": "assistant", "content": assistant_message})

            # Parse JSON response
            try:
                parsed_response = json.loads(assistant_message)
                return parsed_response
            except json.JSONDecodeError:
                # Try to extract JSON from markdown code blocks
                logger.warning(f"Groq response was not valid JSON: {assistant_message}")
                
                # Check for markdown code block format
                json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', assistant_message)
                if json_match:
                    json_str = json_match.group(1)
                    try:
                        parsed_response = json.loads(json_str)
                        return parsed_response
                    except json.JSONDecodeError:
                        pass
                
                return {
                    "action": "unknown",
                    "message": assistant_message,
                    "confidence": 0.5,
                    "parsed_response": assistant_message,
                }

        except Exception as e:
            logger.error(f"Error calling Groq API: {str(e)}")
            return {
                "action": "error",
                "message": f"Error processing command: {str(e)}",
                "confidence": 0,
            }

    def execute_action(self, parsed_response, user=None):
        """Execute the parsed action and handle automatic product creation for restock"""
        action = parsed_response.get("action", "unknown")
        data = parsed_response.get("data", {})
        message = parsed_response.get("message", "")

        logger.info(f"Executing action: {action} with data: {data}")

        # Handle restock_product - auto-create product if it doesn't exist
        if action == "restock_product" and user:
            product_name = data.get("product", "").lower().strip()
            quantity = data.get("quantity", 0)
            
            if product_name and quantity > 0:
                try:
                    # Try to find existing product
                    product = Product.objects.filter(
                        user=user,
                        name__iexact=product_name
                    ).first()
                    
                    if not product:
                        # Auto-create product with sensible defaults
                        sku = f"SKU-{product_name.upper()[:4]}-{Product.objects.filter(user=user).count() + 1}"
                        product = Product.objects.create(
                            user=user,
                            name=product_name.title(),  # Capitalize properly
                            sku=sku,
                            price=data.get("price", 0),  # May be included in data
                            reorder_level=5,
                            stock=quantity
                        )
                        logger.info(f"Auto-created product: {product.name} with SKU: {sku}")
                        message = f"✨ Created new product '{product.name}' and added {quantity} units to stock."
                        data["auto_created"] = True
                    else:
                        # Update existing product stock
                        old_stock = product.stock
                        product.stock += quantity
                        product.save()
                        logger.info(f"Updated product {product.name} stock: {old_stock} → {product.stock}")
                        message = f"Restocked {quantity}x {product.name}. Stock: {old_stock} → {product.stock}"
                        
                    data["product_id"] = product.id
                    data["new_stock"] = product.stock
                except Exception as e:
                    logger.error(f"Error handling restock: {str(e)}")
                    return {
                        "status": "error",
                        "action": action,
                        "message": f"Error updating stock: {str(e)}",
                    }

        result = {
            "status": "success",
            "action": action,
            "data": data,
            "message": message,
            "next_steps": self._get_next_steps(action, data),
        }

        return result

    def _get_next_steps(self, action, data):
        """Get the next steps for the executed action"""
        next_steps = {
            "create_sale": ["POST to /api/v1/sales/ with the sale data"],
            "create_expense": ["POST to /api/v1/expenses/ with the expense data"],
            "restock_product": ["POST to /api/v1/inventory/stock-movements/ to record restock"],
            "query_sales": ["GET /api/v1/reports/daily-sales/"],
            "query_stock": ["GET /api/v1/inventory/products/?status=low"],
            "add_customer_credit": ["POST to /api/v1/customers/{id}/add-credit/"],
            "get_daily_summary": ["GET /api/v1/reports/daily-sales/"],
        }
        return next_steps.get(action, [])

    def clear_history(self):
        """Clear conversation history"""
        self.conversation_history = []


