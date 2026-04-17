import urllib.request
import json

# Test preflight OPTIONS request
print('[CORS PREFLIGHT TEST]')
req = urllib.request.Request(
    'http://127.0.0.1:8080/api/v1/accounts/login/',
    headers={
        'Origin': 'http://localhost:8082',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
    },
    method='OPTIONS'
)

try:
    with urllib.request.urlopen(req, timeout=5) as response:
        headers = dict(response.headers)
        print('Preflight Response Status: {}'.format(response.status))
        print('Access-Control-Allow-Origin: {}'.format(headers.get('Access-Control-Allow-Origin', 'NOT SET')))
        print('Access-Control-Allow-Methods: {}'.format(headers.get('Access-Control-Allow-Methods', 'NOT SET')))
        print('Access-Control-Allow-Headers: {}'.format(headers.get('Access-Control-Allow-Headers', 'NOT SET')))
        
        if headers.get('Access-Control-Allow-Origin') == 'http://localhost:8082':
            print('SUCCESS - CORS preflight passed for localhost:8082')
        else:
            print('WARNING - CORS header not detected in response')
except urllib.error.HTTPError as e:
    headers = dict(e.headers)
    print('Preflight Response Status: {}'.format(e.code))
    print('Access-Control-Allow-Origin: {}'.format(headers.get('Access-Control-Allow-Origin', 'NOT SET')))
    if e.code == 200 or headers.get('Access-Control-Allow-Origin'):
        print('SUCCESS - CORS preflight passed')
except Exception as e:
    print('Error: {}'.format(e))
