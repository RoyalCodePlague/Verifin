import os
import django
import json
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.test import Client
from accounts.models import User

print('=== USERS IN DATABASE ===')
users = User.objects.all()
for u in users:
    print(f'  • {u.email} (onboarded: {u.onboarding_complete})')

print('\n=== TESTING LOGIN ENDPOINT ===')
client = Client()
response = client.post('/api/v1/accounts/login/', {'email': 'admin@admin.com', 'password': 'admin'}, content_type='application/json')
print(f'Status: {response.status_code}')
if response.status_code == 200:
    data = json.loads(response.content)
    print('✓ Login successful!')
    print(f'  • Access token: {bool(data.get("access"))}')
    print(f'  • Refresh token: {bool(data.get("refresh"))}')
else:
    print(f'✗ Login failed: {response.content[:200]}')

print('\n=== TESTING ME ENDPOINT ===')
# Get token first
response = client.post('/api/v1/accounts/login/', {'email': 'admin@admin.com', 'password': 'admin'}, content_type='application/json')
if response.status_code == 200:
    token = json.loads(response.content)['access']
    response = client.get('/api/v1/accounts/me/', HTTP_AUTHORIZATION=f'Bearer {token}')
    print(f'Status: {response.status_code}')
    if response.status_code == 200:
        data = json.loads(response.content)
        print(f'✓ User Me endpoint works!')
        print(f'  • Email: {data.get("email")}')
        print(f'  • Onboarded: {data.get("onboarding_complete")}')
    else:
        print(f'✗ Me endpoint failed: {response.content[:200]}')
