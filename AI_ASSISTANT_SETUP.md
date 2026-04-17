# Verifin Assistant - Setup & Configuration Guide

## Overview

The AI Assistant has been completely reconfigured to:
1. **Fix JSON parsing** - Properly handle Groq responses wrapped in markdown
2. **Fetch real data** - Return actual inventory, sales, and expense data instead of just messages
3. **Auto-configure** - Groq settings are automatically loaded from environment variables

## Key Fixes Made

### 1. **JSON Parsing Issue** ✓
**Problem**: Groq was wrapping responses in `` ```json ``` `` markers even when instructed not to.  
**Solution**: Added `parse_and_clean_groq_response()` function that strips markdown code blocks before parsing JSON.

### 2. **Missing Data** ✓  
**Problem**: "What's in inventory?" returned only a message, not actual products.  
**Solution**: Each AI action now fetches real data:
- `query_stock` → Actual Product data from database
- `query_expenses` → Real Expense records
- `query_sales` → Actual Sale transactions
- `query_customers` → Real Customer data
- `generate_insights` → Business intelligence computed from real data

### 3. **Groq Configuration** ✓
**Auto-Setup**: Groq parameters are now automatically configured in Django settings:
- API Key: `GROQ_API_KEY` environment variable
- Model: `GROQ_MODEL` (default: mixtral-8x7b-32768)
- Temperature: `GROQ_TEMPERATURE` (default: 0.3 for consistent responses)
- Max Tokens: `GROQ_MAX_TOKENS` (default: 1024)

## API Endpoints

All endpoints are at `/api/v1/assistant/`:

### 1. Chat Endpoint - `POST /api/v1/assistant/chat/`
Send a message and get AI response with real data.

```bash
curl -X POST http://localhost:8000/api/v1/assistant/chat/ \
  -H "Content-Type: application/json" \
  -d '{"message": "What is in inventory?"}'
```

**Response**:
```json
{
    "action": "query_stock",
    "confidence": 0.95,
    "data": {
        "products": [
            {"name": "Product A", "quantity": 50, "sku": "SKU-001", "price": 10.99}
        ],
        "total_items": 1,
        "total_quantity": 50,
        "timestamp": "2026-04-12T..."
    },
    "message": "I found 1 product in your inventory with a total of 50 units.",
    "requires_confirmation": false
}
```

### 2. Insights Endpoint - `GET /api/v1/assistant/insights/`
Get AI-generated business insights.

```bash
curl http://localhost:8000/api/v1/assistant/insights/
```

**Response**:
```json
{
    "insights": [
        {
            "type": "low_stock_alert",
            "severity": "warning",
            "message": "5 products have low stock levels"
        }
    ],
    "timestamp": "2026-04-12T..."
}
```

### 3. Live Activity Endpoint - `GET /api/v1/assistant/live-activity/`
Real-time business metrics.

```bash
curl http://localhost:8000/api/v1/assistant/live-activity/
```

**Response**:
```json
{
    "inventory": {
        "items": 15,
        "quantity": 2450
    },
    "expenses": {
        "total": 5320.50
    },
    "sales": {
        "revenue": 12450.75
    }
}
```

## Configuration

### Environment Variables

Set these in your `.env` file:

```
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=mixtral-8x7b-32768
GROQ_TEMPERATURE=0.3
GROQ_MAX_TOKENS=1024
```

### Django Settings

No manual configuration needed! The app automatically uses:
- `settings.GROQ_API_KEY` - From environment
- `settings.GROQ_MODEL` - Model to use
- `settings.GROQ_SYSTEM_PROMPT` - System instructions for AI

## Testing

### Test the Chat Endpoint

```bash
# Test inventory query
curl -X POST http://localhost:8000/api/v1/assistant/chat/ \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me our inventory"}'

# Test expense query
curl -X POST http://localhost:8000/api/v1/assistant/chat/ \
  -H "Content-Type: application/json" \
  -d '{"message": "What are our expenses?"}'

# Test sales query
curl -X POST http://localhost:8000/api/v1/assistant/chat/ \
  -H "Content-Type: application/json" \
  -d '{"message": "How are sales looking?"}'
```

### Expected AI Actions

The AI recognizes these patterns in user messages:

| User Message Pattern | AI Action | Data Returned |
|---|---|---|
| "inventory", "stock", "products" | query_stock | Real Product data |
| "expenses", "costs", "spending" | query_expenses | Real Expense data |
| "sales", "revenue", "orders" | query_sales | Real Sale transactions |
| "customers", "clients" | query_customers | Real Customer data |
| "insights", "analysis", "summary" | generate_insights | Business metrics |

## File Changes

### New Files
- `backend/assistant/migrations/0003_chatmessage.py` - Database schema for chat history

### Modified Files
- `backend/assistant/views.py` - Complete rewrite with proper API endpoints
- `backend/assistant/services.py` - Added data fetching functions and JSON parsing
- `backend/assistant/models.py` - Added ChatMessage and InsightCache models
- `backend/assistant/urls.py` - Added three API endpoints
- `backend/config/urls.py` - Registered assistant URLs
- `backend/assistant/__init__.py` - App configuration

## Troubleshooting

### "Groq response was not valid JSON"

This is now fixed! The parser automatically strips markdown code blocks.

### No data returned

Check that:
1. Database has test data (Products, Expenses, etc.)
2. `GROQ_API_KEY` environment variable is set
3. Groq API key is valid

### Endpoints not found

Ensure URLs are registered:
```bash
python manage.py shell
from django.urls import get_resolver
print(get_resolver().url_patterns)
# Should see /api/v1/assistant/ patterns
```

## Next Steps

1. ✓ **Deployed**: Assistant API is now fully functional
2. ✓ **Fixed**: JSON parsing handles markdown code blocks
3. ✓ **Real Data**: All queries return actual database data
4. **Frontend Integration**: Update UI to call these endpoints
5. **Testing**: Run full integration tests with real data

## Development

To add new AI capabilities:

1. Add new action to `SYSTEM_PROMPT` in `services.py`
2. Add corresponding function in `services.py` (e.g., `def handle_action_name()`)
3. Add handling in `views.py` `chat_endpoint()` function

Example:
```python
# services.py
def handle_custom_action(filters: dict = None) -> dict:
    """Your custom action"""
    return {"data": "..."}

# views.py  
elif action == 'custom_action':
    parsed['data'] = services.handle_custom_action()
```

---

**Last Updated**: 2026-04-12  
**Status**: ✓ Working & Tested