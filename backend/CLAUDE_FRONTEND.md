# Claude AI Integration - Frontend Usage Guide

This guide explains how to integrate Claude AI assistant into your React frontend.

## Quick Setup

### 1. Install Dependencies (Optional)
If you need additional libraries for API calls:
```bash
npm install axios
# or
yarn add axios
```

### 2. Authentication Token
Make sure you have a valid JWT token before making requests. See the accounts API for authentication.

## API Endpoints

### 1. Send Assistant Command

**POST** `/api/v1/assistant/command/`

```javascript
// Example: React component to send assistant command
import axios from 'axios';
import { useState } from 'react';

function AssistantInput() {
  const [command, setCommand] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const token = localStorage.getItem('access_token'); // Your JWT token

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await axios.post(
        'http://localhost:8000/api/v1/assistant/command/',
        { command },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      setResponse(res.data);
      setCommand(''); // Clear input
    } catch (err) {
      setError(err.response?.data?.error || 'Error processing command');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="assistant-input">
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Tell me what you did... e.g., 'I sold 5 loaves for 50 rand'"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !command.trim()}>
          {loading ? 'Processing...' : 'Send'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}
      {response && (
        <div className="response">
          <p><strong>Action:</strong> {response.parsed_action}</p>
          <p><strong>Confidence:</strong> {(response.confidence * 100).toFixed(0)}%</p>
          <p><strong>Message:</strong> {response.message}</p>

          {response.requires_confirmation ? (
            <ConfirmationDialog logId={response.id} />
          ) : (
            <p className="success">Action {response.execution_result?.status}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default AssistantInput;
```

### 2. Fetch Command History

**GET** `/api/v1/assistant/history/?limit=10`

```javascript
import axios from 'axios';
import { useEffect, useState } from 'react';

function AssistantHistory() {
  const [history, setHistory] = useState([]);
  const token = localStorage.getItem('access_token');

  useEffect(() => {
    axios.get(
      'http://localhost:8000/api/v1/assistant/history/?limit=10',
      {
        headers: { 'Authorization': `Bearer ${token}` },
      }
    )
      .then((res) => setHistory(res.data.logs))
      .catch(console.error);
  }, [token]);

  return (
    <div className="history">
      <h3>Recent Commands</h3>
      {history.map((log) => (
        <div key={log.id} className="history-item">
          <p><strong>Command:</strong> {log.command}</p>
          <p><strong>Action:</strong> {log.action}</p>
          <p><strong>Status:</strong> {log.executed ? '✓ Executed' : '⏳ Pending'}</p>
          <p><small>{new Date(log.created_at).toLocaleString()}</small></p>
        </div>
      ))}
    </div>
  );
}

export default AssistantHistory;
```

### 3. Confirm Pending Actions

**POST** `/api/v1/assistant/confirm/<log_id>/`

```javascript
async function confirmAction(logId, confirmed = true) {
  const token = localStorage.getItem('access_token');

  const response = await axios.post(
    `http://localhost:8000/api/v1/assistant/confirm/${logId}/`,
    { confirmed },
    {
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );

  return response.data;
}

// Usage in component
function ConfirmationDialog({ logId }) {
  const handleConfirm = async () => {
    try {
      const result = await confirmAction(logId, true);
      console.log('Action confirmed:', result);
    } catch (error) {
      console.error('Confirmation failed:', error);
    }
  };

  const handleCancel = async () => {
    try {
      const result = await confirmAction(logId, false);
      console.log('Action cancelled:', result);
    } catch (error) {
      console.error('Cancellation failed:', error);
    }
  };

  return (
    <div className="confirmation-dialog">
      <p>Are you sure you want to proceed with this action?</p>
      <button onClick={handleConfirm}>Confirm</button>
      <button onClick={handleCancel}>Cancel</button>
    </div>
  );
}
```

## Response Format

All responses follow this structure:

```json
{
  "id": 1,
  "command": "I sold 3 loaves for R45 each to John",
  "parsed_action": "create_sale",
  "confidence": 0.95,
  "message": "I'll create a sale for 3 loaves of bread at R45 each",
  "requires_confirmation": false,
  "execution_result": {
    "status": "success",
    "action": "create_sale",
    "data": {
      "items": 3,
      "product": "loaves of bread",
      "unit_price": 45,
      "customer": "John",
      "total": 135
    },
    "message": "Sale recorded successfully"
  },
  "next_steps": ["POST to /api/v1/sales/ with the sale data"]
}
```

## Error Handling

```javascript
try {
  const response = await axios.post(
    'http://localhost:8000/api/v1/assistant/command/',
    { command },
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
} catch (error) {
  if (error.response?.status === 401) {
    console.error('Unauthorized - please log in again');
  } else if (error.response?.status === 400) {
    console.error('Invalid command:', error.response.data.error);
  } else if (error.response?.status === 500) {
    console.error('Server error');
  } else if (!error.response) {
    console.error('Network error - check your connection');
  }
}
```

## Complete Example Component

```tsx
// AssistantChat.tsx
import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  text: string;
  action?: string;
  confidence?: number;
}

export function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const token = localStorage.getItem('access_token');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      text: input,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post(
        'http://localhost:8000/api/v1/assistant/command/',
        { command: input },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const assistantMessage: Message = {
        id: response.data.id.toString(),
        type: 'assistant',
        text: response.data.message,
        action: response.data.parsed_action,
        confidence: response.data.confidence,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'assistant',
        text: 'Sorry, I encountered an error. Please try again.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="assistant-chat">
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.type}`}>
            <p>{msg.text}</p>
            {msg.action && (
              <small>
                Action: {msg.action} | Confidence: {(msg.confidence || 0) * 100}%
              </small>
            )}
          </div>
        ))}
        {loading && <div className="message assistant">Processing...</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder="What would you like to do?"
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
```

## Styling Example

```css
/* AssistantChat.css */
.assistant-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid #ccc;
  border-radius: 8px;
  background: white;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  padding: 12px;
  border-radius: 8px;
  max-width: 70%;
  word-wrap: break-word;
}

.message.user {
  align-self: flex-end;
  background: #007bff;
  color: white;
}

.message.assistant {
  align-self: flex-start;
  background: #f0f0f0;
  color: black;
}

.input-area {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid #ccc;
  background: white;
}

.input-area input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.input-area button {
  padding: 10px 20px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.input-area button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

## Common Commands Users Can Say

The Claude assistant understands natural language variations:

- **Sales**: "I sold 3 loaves for R45 each", "Sold to John: 2 eggs, 1 milk"
- **Expenses**: "I spent R200 on transport", "Paid R50 for internet"
- **Inventory**: "Restock 24 Coca-Cola cans", "Added 100 units of rice"
- **Queries**: "How much did I earn today?", "What products are low on stock?"
- **Customers**: "Add R100 credit to John's account", "Show me repeat customers"

## Tips for Best Results

1. **Be Specific**: "I sold 10 bread at R10 each" works better than "I made a sale"
2. **Include Units**: Mention quantities and currencies when possible
3. **Customer Names**: If tracking sales to specific customers, include their names
4. **Dates**: Claude understands relative dates like "yesterday", "last week", "today"

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Make sure you have a valid JWT token in localStorage |
| 400 Bad Request | Check that command text is not empty |
| 500 Server Error | Check Django server logs and ensure Claude API key is set |
| Empty Responses | Try a more specific command or check API rate limits |

## Resources

- [Claude API Docs](https://docs.anthropic.com/en/api/messages)
- [Backend Setup Guide](./CLAUDE_SETUP.md)
- [Backend Examples](./assistant/examples.py)
