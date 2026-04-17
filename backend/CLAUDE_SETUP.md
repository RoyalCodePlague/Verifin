# Claude AI Integration Setup Guide

This guide walks you through setting up Claude AI for your Verifin project.

## 1. Get Your Claude API Key

1. Visit [Anthropic Console](https://console.anthropic.com)
2. Sign up or log in
3. Go to **API Keys** section
4. Create a new API key
5. Copy the key (it starts with `sk-ant-`)

## 2. Install Dependencies

From the `backend` directory:

```bash
pip install -r requirements.txt
```

This installs:
- `anthropic`: Claude API SDK
- `python-dotenv`: Environment variable management

## 3. Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Claude API key:
   ```
   CLAUDE_API_KEY=sk-ant-your-api-key-here
   CLAUDE_MODEL=claude-3-5-sonnet-20241022
   ```

## 4. Create and Run Migrations

```bash
python manage.py makemigrations
python manage.py migrate assistant
```

## 5. Test the Integration

### Via Django Shell

```bash
python manage.py shell
```

```python
from assistant.services import ClaudeAssistantService

service = ClaudeAssistantService()
response = service.parse_command("I sold 3 loaves of bread for R45 each to John")
print(response)
```

### Via API

Start the server:
```bash
python manage.py runserver
```

Make a POST request to `/api/v1/assistant/command/`:

```bash
curl -X POST http://localhost:8000/api/v1/assistant/command/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"command": "I sold 3 loaves of bread for R45 each to John"}'
```

## API Endpoints

### 1. Send Assistant Command
**POST** `/api/v1/assistant/command/`

Request:
```json
{
  "command": "I sold 3 loaves of bread for R45 each to John"
}
```

Response:
```json
{
  "id": 1,
  "command": "I sold 3 loaves of bread for R45 each to John",
  "parsed_action": "create_sale",
  "confidence": 0.95,
  "message": "I'll create a sale for 3 loaves of bread at R45 each to customer John",
  "requires_confirmation": false,
  "execution_result": {
    "status": "success",
    "action": "create_sale",
    "data": {
      "items": 3,
      "product": "loaves of bread",
      "unit_price": 45.0,
      "customer": "John",
      "total": 135.0
    },
    "message": "Sale recorded successfully"
  },
  "next_steps": ["POST to /api/v1/sales/ with the sale data"]
}
```

### 2. Get Command History
**GET** `/api/v1/assistant/history/?limit=10`

Response:
```json
{
  "logs": [
    {
      "id": 1,
      "command": "I sold 3 loaves of bread for R45 each to John",
      "action": "create_sale",
      "confidence": 0.95,
      "executed": true,
      "requires_confirmation": false,
      "created_at": "2025-04-11T10:30:00Z",
      "result": "Sale recorded successfully"
    }
  ]
}
```

### 3. Confirm Pending Action
**POST** `/api/v1/assistant/confirm/<log_id>/`

Request:
```json
{
  "confirmed": true
}
```

Response:
```json
{
  "status": "success",
  "message": "Action executed successfully",
  "execution_result": {...}
}
```

## Supported Commands

Claude can understand natural language variations of:

1. **Recording Sales**
   - "I sold 3 loaves for R45 each"
   - "Sold to John: 2 eggs, 1 milk"
   - "20 units of bread at R10 each"

2. **Logging Expenses**
   - "I spent R200 on transport"
   - "Paid R50 for internet"
   - "Transport expense: R300"

3. **Restocking**
   - "Restock 24 Coca-Cola cans"
   - "Added 100 units of rice"
   - "I got 50 eggs from supplier"

4. **Querying Data**
   - "How much did I earn today?"
   - "What were my sales yesterday?"
   - "What products are low on stock?"
   - "How many loaves sold this week?"

5. **Customer Management**
   - "Add R100 credit to John's account"
   - "What's John's loyalty points?"
   - "Show me repeat customers"

## Advanced Features

### Confidence Scoring
- Claude provides a confidence score (0.0-1.0) for each parsed command
- Actions with confidence > 0.7 are auto-executed
- Lower confidence actions require user confirmation

### Conversation History
- Claude maintains conversation context (up to the session)
- This allows for more natural follow-up questions
- Each user has independent conversation history

### Error Handling
- Missing API key? Check `.env` file
- Invalid JSON response? Claude service logs the raw response
- Permissions errors? Ensure user is authenticated with JWT

## Monitoring & Debugging

View Claude interactions in Django admin:
- Go to `/admin/assistant/assistantlog/`
- See raw AI responses in `ai_response` field
- Check confidence scores and whether actions were executed

View logs:
```bash
tail -f logs/django.log  # If you have logging configured
```

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `CLAUDE_API_KEY` | Your API key from Anthropic | `sk-ant-...` |
| `CLAUDE_MODEL` | Claude model to use | `claude-3-5-sonnet-20241022` |

### Available Claude Models (as of April 2025)
- `claude-3-5-sonnet-20241022` (Recommended - balanced cost/performance)
- `claude-3-opus-20250219` (Most powerful, higher cost)
- `claude-3-haiku-20250307` (Fastest, lower cost)

## Pricing

Claude API pricing (as of April 2025):
- **Sonnet**: $3 per 1M input tokens, $15 per 1M output tokens
- **Opus**: $15 per 1M input tokens, $75 per 1M output tokens
- **Haiku**: $0.80 per 1M input tokens, $4 per 1M output tokens

Typical business commands use ~200-500 tokens each = $0.001-0.005 per command

## Next Steps

1. ✅ Install dependencies
2. ✅ Set up environment variables
3. ✅ Run migrations
4. ✅ Test with API
5. **Integrate with frontend** (React components to send commands)
6. **Add real business logic** (execute_action() methods)
7. **Train custom prompts** for industry-specific terminology

## Troubleshooting

### "Claude API key not configured"
- Ensure `.env` file exists in `backend/` directory
- Verify `CLAUDE_API_KEY` is set correctly (no quotes)

### "Error processing command"
- Check Django logs for the full error
- Verify Claude API key has permissions
- Check internet connection

### Slow responses
- Claude API takes 2-5 seconds typically
- Use `claude-3-haiku` for faster responses (trade-off: less accurate)
- Consider caching common responses

## Support & Resources

- **Anthropic Documentation**: https://docs.anthropic.com
- **Claude API Reference**: https://docs.anthropic.com/en/api/messages
- **Django REST Framework**: https://www.django-rest-framework.org/
