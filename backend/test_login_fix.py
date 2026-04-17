import requests
import json

# Test login with email field
response = requests.post(
    'http://127.0.0.1:8080/api/v1/accounts/login/',
    json={'email': 'admin@admin.com', 'password': 'Pp123456'},
    headers={'Origin': 'http://localhost:8082'}
)

print(f'Status: {response.status_code}')
if response.status_code == 200:
    data = response.json()
    print('✓ Login successful')
    print(f'Access token received: {bool(data.get("access"))}')
    print(f'Refresh token received: {bool(data.get("refresh"))}')
else:
    print(f'Error: {response.text}')
