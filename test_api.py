import requests
import json

resp = requests.post('http://localhost:8000/api/v1/assistant/chat/', 
                    json={'message': 'What products do we have?'})
print(f'Status: {resp.status_code}')
result = resp.json()
print(f'Action: {result.get("action")}')
print(f'Message: {result.get("message")}')
products = result.get('data', {}).get('products', [])
print(f'Total products: {len(products)}')
if products:
    print(f'First product: {products[0]}')
print('\n' + '='*50)
print('Testing Live Activity:')
resp2 = requests.get('http://localhost:8000/api/v1/assistant/live-activity/')
print(f'Status: {resp2.status_code}')
activity = resp2.json()
print(json.dumps(activity, indent=2))
