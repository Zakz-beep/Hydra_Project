import socket
import urllib.request
import json
import logging
import time

# Set up logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Cache resolusi DNS untuk menghindari pemanggilan DoH berulang
# Pre-populate domain DoH sendiri untuk menghindari rekursi tak terbatas
dns_cache = {
    "dns.google": "8.8.8.8",
    "cloudflare-dns.com": "1.1.1.1",
}

# Simpan fungsi getaddrinfo bawaan Python
original_getaddrinfo = socket.getaddrinfo


def custom_resolve(host):
    """
    Menyelesaikan hostname menggunakan Google & Cloudflare DNS-over-HTTPS (DoH) JSON API.
    Bermanfaat untuk bypass sensor/pemblokiran DNS ISP di Indonesia (Internet Positif).
    """
    if host in dns_cache:
        return dns_cache[host]

    # Jangan lakukan DoH untuk localhost, internal IPs, atau input yang sudah berupa IP
    if host == "localhost" or host.startswith("127.") or host.replace(".", "").isdigit():
        return None

    # Cobalah Google DoH terlebih dahulu
    try:
        url = f"https://dns.google/resolve?name={host}&type=A"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as response:
            data = json.loads(response.read().decode())
            if "Answer" in data:
                ips = [item["data"] for item in data["Answer"] if item["type"] == 1]
                if ips:
                    dns_cache[host] = ips[0]
                    logging.info(f"[DNS] Resolved {host} -> {ips[0]} via Google DoH")
                    return ips[0]
    except Exception as e:
        logging.debug(f"Google DoH failed for {host}: {e}")

    # Fallback ke Cloudflare DoH jika Google DoH gagal
    try:
        url = f"https://cloudflare-dns.com/dns-query?name={host}&type=A"
        req = urllib.request.Request(
            url, 
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/dns-json"
            }
        )
        with urllib.request.urlopen(req, timeout=4) as response:
            data = json.loads(response.read().decode())
            if "Answer" in data:
                ips = [item["data"] for item in data["Answer"] if item["type"] == 1]
                if ips:
                    dns_cache[host] = ips[0]
                    logging.info(f"[DNS] Resolved {host} -> {ips[0]} via Cloudflare DoH")
                    return ips[0]
    except Exception as e:
        logging.debug(f"Cloudflare DoH failed for {host}: {e}")

    return None


def patched_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    """
    Fungsi getaddrinfo yang ditambal (patched) agar menggunakan resolusi DoH
    sehingga koneksi HTTP/HTTPS langsung mengarah ke IP bersih.
    """
    resolved_ip = custom_resolve(host)
    if resolved_ip:
        return original_getaddrinfo(resolved_ip, port, family, type, proto, flags)
    return original_getaddrinfo(host, port, family, type, proto, flags)


# Terapkan patch global pada library socket
socket.getaddrinfo = patched_getaddrinfo
logging.info("Global DNS-over-HTTPS patch applied successfully to socket.getaddrinfo.")


# ════════════════════════════════════════════════════════
# CEX FETCHERS
# ════════════════════════════════════════════════════════

def fetch_binance(symbol="BTCUSDT"):
    """Fetch harga dari Binance REST API."""
    try:
        url = f"https://api.binance.com/api/v3/ticker/price?symbol={symbol}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            res = json.loads(response.read().decode())
            return {
                "exchange": "Binance",
                "symbol": symbol,
                "price": float(res["price"]),
                "status": "Success"
            }
    except Exception as e:
        return {"exchange": "Binance", "symbol": symbol, "price": None, "status": f"Error: {e}"}


def fetch_bybit(symbol="BTCUSDT"):
    """Fetch harga dari Bybit V5 API."""
    try:
        url = f"https://api.bybit.com/v5/market/tickers?category=linear&symbol={symbol}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            res = json.loads(response.read().decode())
            price = res["result"]["list"][0]["lastPrice"]
            return {
                "exchange": "Bybit",
                "symbol": symbol,
                "price": float(price),
                "status": "Success"
            }
    except Exception as e:
        return {"exchange": "Bybit", "symbol": symbol, "price": None, "status": f"Error: {e}"}


def fetch_okx(symbol="BTC-USDT"):
    """Fetch harga dari OKX V5 API."""
    try:
        url = f"https://www.okx.com/api/v5/market/ticker?instId={symbol}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            res = json.loads(response.read().decode())
            price = res["data"][0]["last"]
            return {
                "exchange": "OKX",
                "symbol": symbol,
                "price": float(price),
                "status": "Success"
            }
    except Exception as e:
        return {"exchange": "OKX", "symbol": symbol, "price": None, "status": f"Error: {e}"}


def fetch_kucoin(symbol="BTC-USDT"):
    """Fetch harga dari KuCoin V1 API."""
    try:
        url = f"https://api.kucoin.com/api/v1/market/orderbook/level1?symbol={symbol}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            res = json.loads(response.read().decode())
            price = res["data"]["price"]
            return {
                "exchange": "KuCoin",
                "symbol": symbol,
                "price": float(price),
                "status": "Success"
            }
    except Exception as e:
        return {"exchange": "KuCoin", "symbol": symbol, "price": None, "status": f"Error: {e}"}


# ════════════════════════════════════════════════════════
# EXECUTION & TEST
# ════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "="*70)
    print(" CRYPTO CEX TICKER FETCH TESTING (DNS BYPASS INDONESIA)")
    print("="*70)
    
    # List fetcher dan simbol yang dicocokkan
    fetchers = [
        (fetch_binance, "BTCUSDT"),
        (fetch_bybit, "BTCUSDT"),
        (fetch_okx, "BTC-USDT"),
        (fetch_kucoin, "BTC-USDT"),
    ]
    
    print("\n[START] Mengambil harga BTC/USDT dari berbagai CEX...\n")
    
    # Ambil data dari semua CEX
    results = []
    for fetch_fn, symbol in fetchers:
        start_time = time.time()
        res = fetch_fn(symbol)
        elapsed = time.time() - start_time
        res["elapsed_ms"] = int(elapsed * 1000)
        results.append(res)
        
    # Tampilkan hasil dalam bentuk tabel yang rapi
    print("\n" + "-"*75)
    print(f"{'EXCHANGE':<15} | {'SYMBOL':<10} | {'PRICE (USD)':<15} | {'LATENCY':<8} | {'STATUS'}")
    print("-"*75)
    
    for r in results:
        price_str = f"${r['price']:,.2f}" if r['price'] is not None else "N/A"
        latency_str = f"{r['elapsed_ms']}ms"
        print(f"{r['exchange']:<15} | {r['symbol']:<10} | {price_str:<15} | {latency_str:<8} | {r['status']}")
        
    print("-"*75 + "\n")
