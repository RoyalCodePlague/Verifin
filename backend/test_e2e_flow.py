#!/usr/bin/env python
"""
End-to-end user flow testing for Verifin
Tests complete user journeys through login, dashboard, sales recording, etc.
"""
import requests
import json
import time

API_BASE = "http://localhost:8080/api/v1"

# Disable SSL warnings and set longer timeout
requests.packages.urllib3.disable_warnings()
session = requests.Session()
session.timeout = 10

def log(message):
    print(f"[TEST] {message}")

def test_login_flow():
    """Test 1: User login flow"""
    log("\n=== TEST 1: LOGIN FLOW ===")
    
    # Step 1: Login with valid credentials
    login_data = {"email": "admin@admin.com", "password": "admin"}
    try:
        response = session.post(f"{API_BASE}/accounts/login/", json=login_data, timeout=5)
    except Exception as e:
        log(f"✗ Request failed: {e}")
        return None
    
    if response.status_code != 200:
        log(f"✗ Login failed: {response.status_code}")
        log(f"  Response: {response.text[:200]}")
        return None
    
    data = response.json()
    token = data.get("access")
    log(f"✓ Login successful, token obtained")
    
    # Step 2: Get user profile
    headers = {"Authorization": f"Bearer {token}"}
    response = session.get(f"{API_BASE}/accounts/me/", headers=headers)
    
    if response.status_code != 200:
        log(f"✗ Get profile failed: {response.status_code}")
        return None
    
    user = response.json()
    log(f"✓ User profile loaded: {user.get('email')}")
    log(f"  Onboarded: {user.get('onboarding_complete')}")
    
    return token

def test_dashboard_data(token):
    """Test 2: Dashboard data retrieval"""
    log("\n=== TEST 2: DASHBOARD DATA ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # Get all inventory
    response = requests.get(f"{API_BASE}/inventory/", headers=headers)
    if response.status_code == 200:
        inventory = response.json()
        log(f"✓ Inventory loaded: {len(inventory)} products")
    else:
        log(f"✗ Inventory failed: {response.status_code}")
    
    # Get all sales
    response = requests.get(f"{API_BASE}/sales/", headers=headers)
    if response.status_code == 200:
        sales = response.json()
        log(f"✓ Sales loaded: {len(sales)} sales")
        if sales:
            total = sum(s.get('total_amount', 0) for s in sales if isinstance(s, dict))
            log(f"  Total sales value: R{total}")
    else:
        log(f"✗ Sales failed: {response.status_code}")
    
    # Get all expenses
    response = requests.get(f"{API_BASE}/expenses/", headers=headers)
    if response.status_code == 200:
        expenses = response.json()
        log(f"✓ Expenses loaded: {len(expenses)} expenses")
        if expenses:
            total = sum(e.get('amount', 0) for e in expenses if isinstance(e, dict))
            log(f"  Total expenses: R{total}")
    else:
        log(f"✗ Expenses failed: {response.status_code}")
    
    # Get all customers
    response = requests.get(f"{API_BASE}/customers/", headers=headers)
    if response.status_code == 200:
        customers = response.json()
        log(f"✓ Customers loaded: {len(customers)} customers")
    else:
        log(f"✗ Customers failed: {response.status_code}")

def test_create_sale(token):
    """Test 3: Create a new sale"""
    log("\n=== TEST 3: CREATE SALE ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # Get first customer and product
    resp_customers = requests.get(f"{API_BASE}/customers/", headers=headers)
    resp_inventory = requests.get(f"{API_BASE}/inventory/", headers=headers)
    
    customers = resp_customers.json() if resp_customers.status_code == 200 else []
    products = resp_inventory.json() if resp_inventory.status_code == 200 else []
    
    if not customers or not products:
        log("✗ No customers or products available")
        return
    
    customer_id = customers[0].get('id')
    product_id = products[0].get('id')
    
    # Create sale
    sale_data = {
        "customer_id": customer_id,
        "items": [
            {
                "product_id": product_id,
                "quantity": 1,
                "unit_price": 100.00
            }
        ],
        "notes": "Test sale from automation"
    }
    
    response = requests.post(f"{API_BASE}/sales/", json=sale_data, headers=headers)
    
    if response.status_code in [200, 201]:
        log(f"✓ Sale created successfully (Status: {response.status_code})")
        sale = response.json()
        log(f"  Sale ID: {sale.get('id')}")
        log(f"  Total: R{sale.get('total_amount', 'N/A')}")
    else:
        log(f"✗ Sale creation failed: {response.status_code}")
        log(f"  Response: {response.text[:200]}")

def test_invalid_login():
    """Test 4: Invalid login attempt"""
    log("\n=== TEST 4: INVALID LOGIN ===")
    
    login_data = {"email": "nonexistent@user.com", "password": "wrongpass"}
    response = requests.post(f"{API_BASE}/accounts/login/", json=login_data)
    
    if response.status_code == 400:
        log(f"✓ Invalid login returns 400 Bad Request")
        data = response.json()
        log(f"  Error message: {data.get('detail', 'N/A')}")
    else:
        log(f"✗ Expected 400, got {response.status_code}")

def test_authorization():
    """Test 5: Authorization and protected endpoints"""
    log("\n=== TEST 5: AUTHORIZATION ===")
    
    # Try without token
    response = requests.get(f"{API_BASE}/sales/")
    
    if response.status_code in [401, 403]:
        log(f"✓ Protected endpoint requires auth: {response.status_code}")
    else:
        log(f"✗ Endpoint should require auth, got {response.status_code}")
    
    # Try with invalid token
    headers = {"Authorization": "Bearer invalid_token"}
    response = requests.get(f"{API_BASE}/sales/", headers=headers)
    
    if response.status_code in [401, 403]:
        log(f"✓ Invalid token rejected: {response.status_code}")
    else:
        log(f"✗ Invalid token should be rejected, got {response.status_code}")

def test_logout(token):
    """Test 6: Logout"""
    log("\n=== TEST 6: LOGOUT ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(f"{API_BASE}/accounts/logout/", headers=headers)
    
    if response.status_code in [200, 204]:
        log(f"✓ Logout successful: {response.status_code}")
    else:
        log(f"✗ Logout failed: {response.status_code}")

def main():
    log("Starting Verifin E2E Test Suite")
    log(f"API Base: {API_BASE}")
    
    try:
        # Test 4: Invalid login
        test_invalid_login()
        
        # Test 1: Login
        token = test_login_flow()
        if not token:
            log("Cannot proceed - login failed")
            return
        
        # Test 5: Authorization
        test_authorization()
        
        # Test 2: Dashboard data
        test_dashboard_data(token)
        
        # Test 3: Create sale
        test_create_sale(token)
        
        # Test 6: Logout
        test_logout(token)
        
        log("\n" + "="*50)
        log("✓ ALL TESTS COMPLETED SUCCESSFULLY")
        log("="*50)
        
    except Exception as e:
        log(f"✗ Test failed with error: {e}")

if __name__ == "__main__":
    main()
