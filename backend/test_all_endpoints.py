import os
import django
import json
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.test import Client
from accounts.models import User

def test_all_endpoints():
    client = Client()
    
    # Login
    print('=== LOGIN ===')
    response = client.post('/api/v1/accounts/login/', {'email': 'admin@admin.com', 'password': 'admin'}, content_type='application/json')
    if response.status_code != 200:
        print(f'✗ Login failed: {response.status_code}')
        return
    
    token = json.loads(response.content)['access']
    print('✓ Login successful')
    
    auth_headers = {'HTTP_AUTHORIZATION': f'Bearer {token}', 'content_type': 'application/json'}
    
    # Get user profile
    print('\n=== GET USER PROFILE ===')
    response = client.get('/api/v1/accounts/me/', **auth_headers)
    print(f'✓ Me endpoint: {response.status_code}' if response.status_code == 200 else f'✗ Status {response.status_code}')
    
    # Get inventory
    print('\n=== GET INVENTORY ===')
    response = client.get('/api/v1/inventory/', **auth_headers)
    if response.status_code == 200:
        products = json.loads(response.content)
        print(f'✓ Inventory endpoint: {len(products)} products')
    else:
        print(f'✗ Status {response.status_code}')
    
    # Get sales
    print('\n=== GET SALES ===')
    response = client.get('/api/v1/sales/', **auth_headers)
    if response.status_code == 200:
        sales = json.loads(response.content)
        print(f'✓ Sales endpoint: {len(sales)} sales')
    else:
        print(f'✗ Status {response.status_code}')
    
    # Get expenses
    print('\n=== GET EXPENSES ===')
    response = client.get('/api/v1/expenses/', **auth_headers)
    if response.status_code == 200:
        expenses = json.loads(response.content)
        print(f'✓ Expenses endpoint: {len(expenses)} expenses')
    else:
        print(f'✗ Status {response.status_code}')
    
    # Get customers
    print('\n=== GET CUSTOMERS ===')
    response = client.get('/api/v1/customers/', **auth_headers)
    if response.status_code == 200:
        customers = json.loads(response.content)
        print(f'✓ Customers endpoint: {len(customers)} customers')
    else:
        print(f'✗ Status {response.status_code}')
    
    # Create a sale
    print('\n=== CREATE SALE ===')
    sale_data = {
        'customer_id': 1,
        'items': [
            {'product_id': 1, 'quantity': 2, 'unit_price': 100}
        ],
        'notes': 'Test sale'
    }
    response = client.post('/api/v1/sales/', json.dumps(sale_data), **auth_headers)
    if response.status_code in [200, 201]:
        print(f'✓ Create sale: {response.status_code}')
    else:
        print(f'✗ Create sale: {response.status_code}')
        print(f'  Error: {response.content[:200]}')
    
    # Logout
    print('\n=== LOGOUT ===')
    response = client.post('/api/v1/accounts/logout/', json.dumps({}), **auth_headers)
    if response.status_code in [200, 204]:
        print(f'✓ Logout: {response.status_code}')
    else:
        print(f'✗ Logout: {response.status_code}')

test_all_endpoints()
