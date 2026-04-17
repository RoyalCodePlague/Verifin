#!/usr/bin/env python
"""Simplified E2E test using urllib"""
import urllib.request
import urllib.error
import json

BASE_URL = "http://127.0.0.1:8080/api/v1"  # Use 127.0.0.1 instead of localhost

def test_endpoint(method, path, data=None, headers=None):
    """Test an API endpoint"""
    url = f"{BASE_URL}{path}"
    if headers is None:
        headers = {}
    headers['Content-Type'] = 'application/json'
    
    try:
        if data:
            data = json.dumps(data).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=5) as response:
            response_data = json.loads(response.read().decode('utf-8'))
            return response.status, response_data
    except urllib.error.HTTPError as e:
        try:
            error_data = json.loads(e.read().decode('utf-8'))
        except:
            error_data = e.read().decode('utf-8')
        return e.code, error_data
    except Exception as e:
        return None, str(e)

def main():
    print("=" * 60)
    print("VERIFIN - E2E TEST SUITE")
    print("=" * 60)
    
    # Test 1: Invalid login
    print("\n[TEST 1] Invalid Login")
    status, data = test_endpoint('POST', '/accounts/login/', 
                                {'email': 'invalid@user.com', 'password': 'wrong'})
    if status == 400:
        print("[PASS] Invalid login returns 400: {}".format(data.get('detail', 'N/A')))
    else:
        print("[FAIL] Expected 400, got {}".format(status))
    
    # Test 2: Valid login
    print("\n[TEST 2] Valid Login")
    status, data = test_endpoint('POST', '/accounts/login/',
                                {'email': 'admin@admin.com', 'password': 'admin'})
    if status == 200:
        token = data.get('access')
        print("[PASS] Login successful, token: {}...".format(token[:20]))
    else:
        print("[FAIL] Login failed, status {}: {}".format(status, data))
        return
    
    # Test 3: Get user profile
    print("\n[TEST 3] Get User Profile")
    auth_header = {'Authorization': 'Bearer {}'.format(token)}
    status, data = test_endpoint('GET', '/accounts/me/', headers=auth_header)
    if status == 200:
        print("[PASS] Profile loaded: {}".format(data.get('email')))
        print("       Onboarded: {}".format(data.get('onboarding_complete')))
    else:
        print("[FAIL] Failed to get profile: {}".format(status))
    
    # Test 4: Get inventory
    print("\n[TEST 4] Get Inventory")
    status, data = test_endpoint('GET', '/inventory/', headers=auth_header)
    if status == 200:
        print("[PASS] Inventory: {} products".format(len(data)))
    else:
        print("[FAIL] Failed: {}".format(status))
    
    # Test 5: Get sales
    print("\n[TEST 5] Get Sales")
    status, data = test_endpoint('GET', '/sales/', headers=auth_header)
    if status == 200:
        print("[PASS] Sales: {} sales".format(len(data)))
    else:
        print("[FAIL] Failed: {}".format(status))
    
    # Test 6: Get expenses
    print("\n[TEST 6] Get Expenses")
    status, data = test_endpoint('GET', '/expenses/', headers=auth_header)
    if status == 200:
        print("[PASS] Expenses: {} expenses".format(len(data)))
    else:
        print("[FAIL] Failed: {}".format(status))
    
    # Test 7: Get customers
    print("\n[TEST 7] Get Customers")
    status, data = test_endpoint('GET', '/customers/', headers=auth_header)
    if status == 200:
        print("[PASS] Customers: {} customers".format(len(data)))
    else:
        print("[FAIL] Failed: {}".format(status))
    
    # Test 8: Create sale
    print("\n[TEST 8] Create Sale")
    sale_data = {
        'customer_id': 1,
        'items': [{'product_id': 1, 'quantity': 1, 'unit_price': 100}],
        'notes': 'E2E test sale'
    }
    status, data = test_endpoint('POST', '/sales/', data=sale_data, headers=auth_header)
    if status in [200, 201]:
        print("[PASS] Sale created: {}".format(data.get('id')))
    else:
        print("[FAIL] Failed: {} - {}".format(status, data))
    
    # Test 9: Logout
    print("\n[TEST 9] Logout")
    status, data = test_endpoint('POST', '/accounts/logout/',data={}, headers=auth_header)
    if status in [200, 204]:
        print("[PASS] Logout successful")
    else:
        print("[FAIL] Failed: {}".format(status))
    
    print("\n" + "=" * 60)
    print("ALL TESTS COMPLETED")
    print("=" * 60)

if __name__ == "__main__":
    main()
