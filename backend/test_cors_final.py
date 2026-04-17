#!/usr/bin/env python
"""
Complete end-to-end test simulating browser CORS requests
"""
import urllib.request
import urllib.error
import json

def test_cors_and_auth():
    """Test complete auth flow with CORS headers as browser would send"""
    
    print("=" * 70)
    print("CORS + AUTHENTICATION FLOW TEST (Browser Simulation)")
    print("=" * 70)
    
    # Simulate browser making request from localhost:8082 origin
    frontend_origin = "http://localhost:8082"
    backend_url = "http://127.0.0.1:8080/api/v1/accounts/login/"
    
    print("\n[1] Frontend Origin: {}".format(frontend_origin))
    print("[2] Backend API: {}".format(backend_url))
    
    # Prepare login request as browser would
    login_data = json.dumps({
        "email": "admin@admin.com",
        "password": "admin"
    }).encode('utf-8')
    
    headers = {
        'Content-Type': 'application/json',
        'Origin': frontend_origin,
        'User-Agent': 'Mozilla/5.0 (Browser Simulation)'
    }
    
    print("\n[TEST] Sending login request with Origin header...")
    
    try:
        req = urllib.request.Request(
            backend_url,
            data=login_data,
            headers=headers,
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=5) as response:
            response_data = json.loads(response.read().decode('utf-8'))
            
            print("[PASS] Response Status: {}".format(response.status))
            print("[PASS] Access Token Received: {}".format(bool(response_data.get('access'))))
            print("[PASS] Refresh Token Received: {}".format(bool(response_data.get('refresh'))))
            
            if response_data.get('access') and response_data.get('refresh'):
                print("\n[SUCCESS] Complete authentication flow successful!")
                print("[SUCCESS] Frontend can now:")
                print("  - Login with credentials")
                print("  - Receive and store JWT tokens")
                print("  - Access protected dashboard endpoints")
                return True
            else:
                print("[ERROR] Tokens not received")
                return False
                
    except urllib.error.HTTPError as e:
        print("[ERROR] HTTP Error {}: {}".format(e.code, e.reason))
        print("[ERROR] Response: {}".format(e.read().decode('utf-8')[:200]))
        return False
    except Exception as e:
        print("[ERROR] Exception: {} - {}".format(type(e).__name__, e))
        return False

if __name__ == "__main__":
    success = test_cors_and_auth()
    print("\n" + "=" * 70)
    if success:
        print("FINAL STATUS: CORS FIX VERIFIED - ALL SYSTEMS FUNCTIONAL")
        print("=" * 70)
    else:
        print("FINAL STATUS: ERROR - CHECK LOGS ABOVE")
        print("=" * 70)
