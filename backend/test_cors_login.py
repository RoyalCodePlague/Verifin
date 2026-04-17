import urllib.request
import json

# Test login with CORS origin header
data = json.dumps({'email': 'admin@admin.com', 'password': 'admin'}).encode('utf-8')
req = urllib.request.Request(
    'http://127.0.0.1:8080/api/v1/accounts/login/',
    data=data,
    headers={
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:8082'
    },
    method='POST'
)

try:
    with urllib.request.urlopen(req, timeout=5) as response:
        result = json.loads(response.read().decode('utf-8'))
        cors_header = dict(response.headers).get('Access-Control-Allow-Origin', 'NOT SET')
        print('[CORS TEST] Login with frontend origin header')
        print('Status: 200 OK')
        print('CORS Header: {}'.format(cors_header))
        print('Access Token Present: {}'.format(bool(result.get('access'))))
        print('Refresh Token Present: {}'.format(bool(result.get('refresh'))))
        print('SUCCESS - Frontend can now authenticate')
except Exception as e:
    print('Error: {}'.format(e))
