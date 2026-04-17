# 🔧 Troubleshooting the AI Assistant 500 Error

## ✅ Backend Status
The backend API is working perfectly! Tests confirm:
- ✅ `POST /api/v1/assistant/command/` returns 200 OK
- ✅ Groq AI parsing is working
- ✅ Product auto-creation works
- ✅ All database operations work

## ❌ Likely Frontend Issues

The 500 error is probably coming from one of these:

### 1. **User Not Logged In**
- Open browser DevTools (F12)
- Go to Application → LocalStorage
- Check if `sp_access_token` exists
- **Fix**: Log in first at your login page

### 2. **JWT Token Expired**
- Tokens expire after ~1 hour
- **Fix**: Log out and log back in

### 3. **CORS or Network Issue**
- Open DevTools → Network tab
- Click on the `command/` request in the network tab
- Check:
  - Status: Should be 200 (not 500)
  - Response: Should show parsed_action, confidence, message
  - Headers: Should have `Authorization: Bearer ...`

### 4. **Backend Not Running**
- Check terminal where you ran `python manage.py runserver`
- Should show `Starting development server at http://127.0.0.1:8000`
- **Fix**: Start the server if it's not running

### 5. **Database Connection Issue**
- Check if migrations were applied: `python manage.py migrate`
- Check if database has errors in Django admin: `http://localhost:8000/admin`

## 🔍 Step-by-Step Debugging

### Step 1: Verify Backend is Running
```bash
# Terminal 1: Backend
cd backend
python manage.py runserver

# You should see:
# Starting development server at http://127.0.0.1:8000/
# Quit the server with CTRL-BREAK.
```

### Step 2: Verify Frontend is Running
```bash
# Terminal 2: Frontend
cd .
npm run dev

# You should see:
# ➜  Local:   http://localhost:8080/
```

### Step 3: Test Backend Directly
```bash
# Terminal 3: Test API
curl -X POST http://127.0.0.1:8000/api/v1/assistant/command/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{"command": "Add 30 apples"}'

# Should return:
# {"parsed_action": "restock_product", "confidence": 0.9, ...}
```

### Step 4: Check Frontend Logs
Open browser DevTools → Console
```
1. Try: "Add 30 apples"
2. Look for error messages
3. Check Network tab → command/ request
```

## 🐛 Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Not logged in or token expired | Login again |
| `404 Not Found` | Backend endpoint missing | Check server logs |
| `500 Internal Server Error` | Backend crashed | Check Django logs |
| `Network error` | Backend not running | Start `python manage.py runserver` |

## 📋 Checklist

- [ ] Is Django backend running on port 8000?
- [ ] Is the frontend running on port 8080?
- [ ] Are you logged into the app?
- [ ] Did you check the Network tab in DevTools?
- [ ] Did you check the Django admin? http://localhost:8000/admin
- [ ] Did migrations run? `python manage.py migrate --run-syncdb`

## 💡 Pro Debugging Tips

### Check Backend Logs
```bash
# Terminal where runserver is running - look for error messages
# Should show: "Groq response:" followed by the JSON
```

### Check Django Admin
```
1. Open http://localhost:8000/admin
2. Login with superuser credentials
3. Check: Accounts > Users > Your user exists
4. Check: Assistant > Assistant Logs > Latest commands
```

### Test Manually with Python
```bash
cd backend
python test_assistant_api.py
```

This tests the full flow end-to-end without the frontend.

## If Nothing Works

1. **Clear Browser Cache**: Ctrl+Shift+Delete in Chrome
2. **Restart Backend**: Stop and restart `python manage.py runserver`
3. **Check Groq API**: Visit https://console.groq.com to verify your key is valid
4. **Full Reset**:
   ```bash
   cd backend
   python manage.py migrate --run-syncdb
   python manage.py createsuperuser
   python manage.py runserver
   ```

## 🎯 Next Steps

Once it's working:
1. Say "Add 30 apples" in the chat
2. Verify it creates the product in inventory
3. Check Django admin to see the log entry

Good luck! 🚀
