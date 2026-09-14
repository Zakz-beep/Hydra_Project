import socket
import urllib.request
import json
import logging
import time
import sys
import io

# Setup stdout untuk mendukung karakter khusus dan unicode emoji
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Set up logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Cache DNS dengan DNS Google & Cloudflare untuk menghindari rekursi tak terbatas
dns_cache = {
    "dns.google": "8.8.8.8",
    "cloudflare-dns.com": "1.1.1.1",
}
original_getaddrinfo = socket.getaddrinfo


def custom_resolve(host):
    """
    Menyelesaikan hostname menggunakan Google & Cloudflare DNS-over-HTTPS (DoH).
    Bermanfaat untuk bypass pemblokiran ISP lokal Indonesia (Internet Positif).
    """
    if host in dns_cache:
        return dns_cache[host]

    if host == "localhost" or host.startswith("127.") or host.replace(".", "").isdigit():
        return None

    # Google DoH
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

    # Cloudflare DoH
    try:
        url = f"https://cloudflare-dns.com/dns-query?name={host}&type=A"
        req = urllib.request.Request(
            url, 
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/dns-json"}
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
    resolved_ip = custom_resolve(host)
    if resolved_ip:
        return original_getaddrinfo(resolved_ip, port, family, type, proto, flags)
    return original_getaddrinfo(host, port, family, type, proto, flags)


# Terapkan patch global pada library socket
socket.getaddrinfo = patched_getaddrinfo
logging.info("Global DNS-over-HTTPS patch applied successfully to socket.getaddrinfo.")


def fetch_altcoin_markets(per_page=100, page=1):
    """
    Mengambil data pasar altcoin teratas dari CoinGecko API.
    Bypass otomatis sensor Indonesia menggunakan DNS patch.
    """
    url = f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page={per_page}&page={page}&sparkline=false&price_change_percentage=24h"
    
    # CoinGecko memblokir User-Agent python bawaan, gunakan browser header
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }
    
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        logging.error(f"Gagal mengambil data dari CoinGecko: {e}")
        return []


def run_altcoin_screener(category="all", min_volume=10000000, sort_by="market_cap"):
    """
    Screener Altcoin berdasarkan filter tertentu.
    - category: 'all', 'large_cap' (> $10B), 'mid_cap' ($1B - $10B), 'small_cap' (< $1B)
    - min_volume: Minimum 24h volume (dalam USD)
    - sort_by: 'market_cap', 'volume', 'change_24h'
    """
    print("\n" + "="*85)
    print(f" COIN GECKO ALTCOIN SCREENER (DNS BYPASS)")
    print(f" Filter: Kategori={category.upper()} | Min Vol 24h=${min_volume:,.0f} | Sort={sort_by.upper()}")
    print("="*85)
    
    print("\n[STEP 1] Mengunduh data pasar koin dari CoinGecko...")
    # Tarik koin teratas (kita ambil top 150 agar mencakup mid/small caps)
    raw_coins = []
    for page in [1, 2]:
        logging.info(f"Mengunduh Halaman {page}...")
        data = fetch_altcoin_markets(per_page=100, page=page)
        if data:
            raw_coins.extend(data)
        time.sleep(1.5) # Jeda sopan untuk menghindari rate-limit CoinGecko
        
    if not raw_coins:
        print("\n[ERROR] Tidak dapat memuat data. Mohon periksa koneksi internet atau rate limit.")
        return

    # Filter out Bitcoin (BTC) karena kita mencari ALTCOIN
    altcoins = [coin for coin in raw_coins if coin["symbol"].lower() != "btc"]
    
    # Kategori Filter berdasarkan Market Cap
    screened_coins = []
    for coin in altcoins:
        mcap = coin.get("market_cap") or 0
        vol24h = coin.get("total_volume") or 0
        price_change = coin.get("price_change_percentage_24h") or 0.0
        
        # 1. Filter Minimum Volume 24 Jam
        if vol24h < min_volume:
            continue
            
        # 2. Filter Kategori Market Cap
        if category == "large_cap" and mcap < 10000000000:
            continue
        elif category == "mid_cap" and (mcap < 1000000000 or mcap >= 10000000000):
            continue
        elif category == "small_cap" and mcap >= 1000000000:
            continue
            
        screened_coins.append(coin)

    # Pengurutan (Sorting)
    if sort_by == "market_cap":
        screened_coins.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)
    elif sort_by == "volume":
        screened_coins.sort(key=lambda x: x.get("total_volume") or 0, reverse=True)
    elif sort_by == "change_24h":
        screened_coins.sort(key=lambda x: x.get("price_change_percentage_24h") or 0.0, reverse=True)

    # Cetak Hasil
    print("\n" + "-"*95)
    print(f"{'RANK':<5} | {'NAME (SYMBOL)':<22} | {'PRICE (USD)':<14} | {'MARKET CAP (USD)':<18} | {'VOLUME 24H (USD)':<16} | {'24H CHG (%)'}")
    print("-"*95)
    
    for i, coin in enumerate(screened_coins[:30], 1): # Batasi top 30 hasil screening
        symbol = coin["symbol"].upper()
        name_str = f"{coin['name']} ({symbol})"
        price = coin.get("current_price") or 0.0
        mcap = coin.get("market_cap") or 0
        vol = coin.get("total_volume") or 0
        change = coin.get("price_change_percentage_24h") or 0.0
        
        # Format harga (desimal lebih banyak untuk koin murah)
        if price >= 1.0:
            price_str = f"${price:,.2f}"
        else:
            price_str = f"${price:,.6f}"
            
        # Warna/Simbol untuk 24h change
        change_prefix = "+" if change > 0 else ""
        change_emoji = "🟢" if change > 0 else "🔴" if change < 0 else "⚪"
        change_str = f"{change_emoji} {change_prefix}{change:.2f}%"
        
        # Format Singkatan Juta/Miliar untuk MCap & Volume
        def format_large_number(num):
            if num >= 1e9:
                return f"${num/1e9:,.2f} B"
            elif num >= 1e6:
                return f"${num/1e6:,.2f} M"
            else:
                return f"${num:,.0f}"

        mcap_str = format_large_number(mcap)
        vol_str = format_large_number(vol)
        
        print(f"{i:<5} | {name_str:<22} | {price_str:<14} | {mcap_str:<18} | {vol_str:<16} | {change_str}")
        
    print("-"*95)
    print(f"Menampilkan {min(len(screened_coins), 30)} dari total {len(screened_coins)} altcoins yang lolos screening.\n")


if __name__ == "__main__":
    # Jalankan test screener:
    # Altcoin Mid-Cap ($1B - $10B), min volume $20M, diurutkan dari perubahan 24h tertinggi (gainers)
    run_altcoin_screener(category="mid_cap", min_volume=20000000, sort_by="change_24h")
