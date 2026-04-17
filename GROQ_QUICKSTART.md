# Groq AI Integration - Quick Start Guide

## ✅ Current Status
Your Groq AI assistant is fully configured and ready to use!

### Configuration
- **Model**: llama-3.3-70b-versatile (latest stable Groq model)
- **API Key**: Configured in `.env` file
- **Backend**: Django REST Framework with JWT authentication
- **Database**: SQLite with AssistantLog table for tracking AI commands

## 🚀 Getting Started

### 1. Start Django Development Server
```bash
cd backend
python manage.py runserver
```

The server will run at `http://localhost:8000`

### 2. Create Test User (Required for API Auth)
```bash
python manage.py shell
```

Then in the Django shell:
```python
from django.contrib.auth import get_user_model
User = get_user_model()
user = User.objects.create_user('test@example.com', 'testpass123')
print(f"User created: {user.email}")
```

### 3. Get JWT Token
```bash
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "testpass123"}'
```

This returns a token like:
```json
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

### 4. Test AI Endpoint
```bash
curl -X POST http://localhost:8000/api/v1/assistant/command/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{"command": "I sold 5 loaves of bread for R50 each to John"}'
```

Expected Response:
```json
{
  "action": "create_sale",
  "confidence": 0.92,
  "data": {
    "product": "bread",
    "quantity": 5,
    "price": 50.0,
    "customer": "John",
    "total": 250.0
  },
  "message": "Sale recorded: 5 loaves of bread to John for R250.00. Is this correct?",
  "requires_confirmation": true
}
```

## 📋 Supported Commands

### Sales
- "I sold 3 loaves of bread for R45 each to John"
- "Sold 10 Coca-Cola cans for R20 each"
- "Customer John bought 2 kg sugar for R80"

### Expenses
- "I spent R200 on transport today"
- "Bought flour for R500"
- "Paid R150 in electricity"

### Inventory
- "Restocked 24 Coca-Cola cans"
- "Added 50 kg flour to stock"
- "Received 30 loaves of bread"

### Queries
- "How much did I earn today?"
- "What were my sales this week?"
- "What products are low on stock?"
- "Show my expenses for today"

## 🛠️ API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/assistant/command/` | Send natural language command |
| GET | `/api/v1/assistant/history/` | Get AI interaction history |
| POST | `/api/v1/assistant/confirm/<id>/` | Confirm action execution |

## 📊 Monitor AI Logs

Then visit the Django Admin:
```
http://localhost:8000/admin/assistant/assistantlog/
```

Login with your superuser account to see all AI interactions.

## 🔧 Available Models

If you want to switch models, update `.env`:

```bash
# Current model (recommended)
GROQ_MODEL=llama-3.3-70b-versatile

# Or try these alternatives:
# GROQ_MODEL=llama-3.1-8b-instant          # Faster, smaller
# GROQ_MODEL=gemma-7b-it                   # Alternative
# GROQ_MODEL=mixtral-8x7b-32768           # No longer available
```

## 📚 Resources

- **Groq API Docs**: https://console.groq.com/docs
- **Django Admin**: http://localhost:8000/admin/
- **API Endpoints**: `/api/v1/assistant/`

## ⚙️ Troubleshooting

**Q: API key invalid?**
- A: Check `.env` file has correct `GROQ_API_KEY`

**Q: Model not found?**
- A: The model may be decommissioned. Visit https://console.groq.com/docs/models to see active models and update `GROQ_MODEL` in `.env`

**Q: No response from AI?**
- A: Check internet connection and verify API key quota isn't exceeded

**Q: Database errors?**
- A: Run migrations: `python manage.py migrate`

## 🎯 Next Steps

1. Integrate with React frontend (see `CLAUDE_FRONTEND.md`)
2. Set up production environment with proper secret management
3. Implement action execution logic for parsed commands
4. Add database transaction handling for financial operations
