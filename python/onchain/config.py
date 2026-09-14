# python/onchain/config.py
# Konfigurasi centralized untuk On-Chain Analysis Engine

# ─── Public RPC Endpoints (dirotasi jika salah satu timeout) ─────────────────
# Hanya endpoint yang CONFIRMED bekerja dari jaringan lokal:
RPC_ENDPOINTS = [
    "https://rpc.mevblocker.io",
    "https://ethereum-rpc.publicnode.com",
]

# ─── Polling Interval ─────────────────────────────────────────────────────────
BLOCK_POLL_INTERVAL = 12  # detik (≈ 1 blok Ethereum)
RPC_TIMEOUT = 10          # detik timeout per request

# ─── Whale Thresholds ─────────────────────────────────────────────────────────
WHALE_ETH_THRESHOLD = 50.0           # ≥ 50 ETH → Whale
WHALE_TOKEN_USD_THRESHOLD = 500_000  # ≥ $500,000 token value → Whale

# ─── Harga referensi ETH (diperbarui otomatis dari CoinGecko jika tersedia) ───
DEFAULT_ETH_PRICE_USD = 3400.0   # Fallback jika CoinGecko tidak tersedia
COINGECKO_PRICE_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=ethereum&vs_currencies=usd"
)

# ─── Daftar Alamat Exchange Terkenal (untuk labeling otomatis) ────────────────
EXCHANGE_LABELS: dict[str, str] = {
    # Binance
    "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
    "0xb38e8c17e38363af6ebdcb3dae12e0243582891d": "Binance",
    # Coinbase
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
    "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
    "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
    # Kraken
    "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
    "0xae2d4617c862309a3d75a0ffb358c7a5009c673f": "Kraken",
    # OKX
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
    "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": "OKX",
    # Bitfinex
    "0x1151314c646ce4e0efd76d1af4760ae66a9fe30f": "Bitfinex",
    "0x742d35cc6634c0532925a3b844bc454e4438f44e": "Bitfinex",
    # Huobi/HTX
    "0xadb2b42f6bd96f5c65920b9ac88619dce4166f94": "Huobi/HTX",
    "0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b": "Huobi/HTX",
}

# ─── ABI Minimal ERC-20 (hanya field yang dipakai untuk decode) ───────────────
# Method IDs (4 bytes pertama dari keccak256 hash function signature)
ERC20_METHOD_IDS: dict[str, str] = {
    "0xa9059cbb": "transfer(address,uint256)",
    "0x23b872dd": "transferFrom(address,address,uint256)",
    "0x095ea7b3": "approve(address,uint256)",
    "0x40c10f19": "mint(address,uint256)",
    "0x42966c68": "burn(uint256)",
    "0x7ff36ab5": "swapExactETHForTokens",
    "0x38ed1739": "swapExactTokensForTokens",
    "0x18cbafe5": "swapExactTokensForETH",
    "0x5c11d795": "swapExactTokensForTokensSupportingFeeOnTransferTokens",
    "0xe8e33700": "addLiquidity",
    "0xf305d719": "addLiquidityETH",
    "0xbaa2abde": "removeLiquidity",
    "0x6a761202": "execTransaction(Gnosis Safe)",
    "0x3593564c": "execute(Uniswap V3 UniversalRouter)",
    "0x12aa3caf": "swap(1inch)",
    "0xe449022e": "uniswapV3Swap",
    "0x128acb08": "swap(Uniswap V3 Pool)",
}

# ─── Token Addresses Terkenal ─────────────────────────────────────────────────
KNOWN_TOKENS: dict[str, dict] = {
    "0xdac17f958d2ee523a2206206994597c13d831ec7": {
        "symbol": "USDT",
        "decimals": 6,
        "name": "Tether USD",
    },
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "symbol": "USDC",
        "decimals": 6,
        "name": "USD Coin",
    },
    "0x6b175474e89094c44da98b954eedeac495271d0f": {
        "symbol": "DAI",
        "decimals": 18,
        "name": "Dai Stablecoin",
    },
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
        "symbol": "WBTC",
        "decimals": 8,
        "name": "Wrapped BTC",
    },
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
        "symbol": "WETH",
        "decimals": 18,
        "name": "Wrapped ETH",
    },
    "0x514910771af9ca656af840dff83e8264ecf986ca": {
        "symbol": "LINK",
        "decimals": 18,
        "name": "Chainlink",
    },
    "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
        "symbol": "UNI",
        "decimals": 18,
        "name": "Uniswap",
    },
    "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": {
        "symbol": "AAVE",
        "decimals": 18,
        "name": "Aave",
    },
}

# ─── SQLite Database Path ─────────────────────────────────────────────────────
import os
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "onchain.db")

# ─── Jumlah transaksi per batch fetch ─────────────────────────────────────────
TX_BATCH_LIMIT = 100    # Ambil max 100 tx per polling cycle
MAX_BLOCKS_PER_FETCH = 3  # Fetch 3 blok terakhir setiap polling
