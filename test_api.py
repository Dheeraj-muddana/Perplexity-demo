import requests
try:
    resp = requests.post("http://127.0.0.1:5000/api/search", json={"query": "test"})
    print(f"Status: {resp.status_code}")
    print(f"Content-type: {resp.headers.get('Content-Type')}")
    print(f"Preview: {resp.text[:200]}")
except Exception as e:
    print(f"Error: {e}")
