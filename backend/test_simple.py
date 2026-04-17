import subprocess
import sys

# Test with simple curl
urls = [
    "http://localhost:8080/",
    "http://localhost:8080/api/v1/",
    "http://localhost:8080/api/v1/accounts/login/",
]

for url in urls:
    print(f"Testing: {url}")
try:
        result = subprocess.run([
            "powershell", "-Command",
            f'Invoke-WebRequest "{url}" -Method POST -Body @{{email="admin@admin.com";password="admin"}} | Select-Object -Property StatusCode'
        ], capture_output=True, text=True, timeout=5)
        print(f"  Output: {result.stdout}")
        print(f"  Error: {result.stderr}")
    except Exception as e:
        print(f"  Exception: {e}")
