import urllib.request
import urllib.error
import json

def test_127():
    url = "http://127.0.0.1:8080/api/v1/accounts/login/"
    data = json.dumps({"email": "admin@admin.com", "password": "admin"}).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    
    try:
        req = urllib.request.Request(url, data=data, headers=headers, method='POST')
        response = urllib.request.urlopen(req, timeout=5)
        result = json.loads(response.read().decode('utf-8'))
        print(f"✓ 127.0.0.1:8080 works! Status: {response.status}")
        print(f"  Response: {result}")
    except urllib.error.HTTPError as e:
        print(f"✗ HTTPError {e.code}: {e.reason}")
        try:
            print(f"  Body: {json.loads(e.read())}")
        except:
            pass
    except Exception as e:
        print(f"✗ Exception: {type(e).__name__}: {e}")

def test_localhost():
    url = "http://localhost:8080/api/v1/accounts/login/"
    data = json.dumps({"email": "admin@admin.com", "password": "admin"}).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    
    try:
        req = urllib.request.Request(url, data=data, headers=headers, method='POST')
        response = urllib.request.urlopen(req, timeout=5)
        result = json.loads(response.read().decode('utf-8'))
        print(f"✓ localhost:8080 works! Status: {response.status}")
        print(f"  Response: {result}")
    except urllib.error.HTTPError as e:
        print(f"✗ HTTPError {e.code}: {e.reason}")
    except Exception as e:
        print(f"✗ Exception: {type(e).__name__}: {e}")

if __name__ == "__main__":
    print("Testing 127.0.0.1...")
    test_127()
    print("\nTesting localhost...")
    test_localhost()
