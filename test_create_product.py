#!/usr/bin/env python
"""Test product creation via AI assistant"""
import requests
import json

BASE_URL = "http://localhost:8000"

def test_create_product():
    """Test creating a product via the command endpoint"""
    print("=" * 60)
    print("TESTING PRODUCT CREATION")
    print("=" * 60)
    
    # Test 1: Create a product
    print("\n1. Creating product: 50 Coca-Cola bottles at R15 each")
    url = f"{BASE_URL}/api/v1/assistant/command/"
    payload = {"command": "Add 50 Coca-Cola bottles to inventory at R15 each"}
    
    response = requests.post(url, json=payload)
    print(f"   Status: {response.status_code}")
    
    if response.status_code == 200:
        result = response.json()
        action = result.get("parsed_action")
        message = result.get("message")
        data = result.get("execution_result", {}).get("data", {})
        
        print(f"   Action: {action}")
        print(f"   Message: {message}")
        print(f"   Product ID: {data.get('id')}")
        print(f"   Product Name: {data.get('name')}")
        print(f"   Product Stock: {data.get('stock')}")
        print(f"   Product Price: {data.get('price')}")
    else:
        print(f"   ERROR: {response.text}")
        return
    
    # Test 2: Verify product exists in inventory
    print("\n2. Verifying product in inventory endpoint")
    url = f"{BASE_URL}/api/v1/inventory/"
    response = requests.get(url)
    print(f"   Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        results = data.get("results", [])
        print(f"   Total products in system: {len(results)}")
        
        # Find our newly created product
        coca_cola = None
        for product in results:
            if "coca" in product.get("name", "").lower():
                coca_cola = product
                break
        
        if coca_cola:
            print(f"\n   ✅ FOUND COCA-COLA PRODUCT:")
            print(f"      Name: {coca_cola.get('name')}")
            print(f"      Stock: {coca_cola.get('stock')} units")
            print(f"      Price: R{coca_cola.get('price')}")
            print(f"      SKU: {coca_cola.get('sku')}")
        else:
            print(f"\n   ❌ Coca-Cola product NOT found in inventory")
            print(f"   Available products:")
            for product in results:
                print(f"      - {product.get('name')}: {product.get('stock')} units")
    else:
        print(f"   ERROR: {response.text}")
    
    # Test 3: Create another product with different details
    print("\n3. Creating another product: 20 iPhones at R8999 each")
    url = f"{BASE_URL}/api/v1/assistant/command/"
    payload = {"command": "I need to add 20 iPhones to inventory, they cost R8999 each"}
    
    response = requests.post(url, json=payload)
    print(f"   Status: {response.status_code}")
    
    if response.status_code == 200:
        result = response.json()
        data = result.get("execution_result", {}).get("data", {})
        print(f"   Product Name: {data.get('name')}")
        print(f"   Product Stock: {data.get('stock')}")
        print(f"   Product Price: {data.get('price')}")
    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    test_create_product()
