import json, urllib.request

endpoints = [
    "https://eth.llamarpc.com",
    "https://1rpc.io/eth",
    "https://rpc.mevblocker.io",
    "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
    "https://ethereum-rpc.publicnode.com",
]

payload = json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}).encode()

for ep in endpoints:
    try:
        req = urllib.request.Request(
            ep, data=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read())
            if "result" in data:
                block = int(data["result"], 16)
                print(f"OK: {ep} -> block {block}")
            else:
                msg = data.get("error", {}).get("message", "unknown")
                print(f"ERR: {ep} -> {msg}")
    except Exception as e:
        print(f"FAIL: {ep} -> {e}")
