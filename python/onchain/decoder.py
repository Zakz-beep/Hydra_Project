# python/onchain/decoder.py
# Decode data transaksi Ethereum mentah dari hex ke format yang bisa dibaca manusia
# Mengimplementasikan decoding manual tanpa library ABI eksternal

import logging
from typing import Optional

from config import ERC20_METHOD_IDS, KNOWN_TOKENS

logger = logging.getLogger(__name__)


# ─── Konstanta ────────────────────────────────────────────────────────────────
# Ukuran satu "word" dalam ABI encoding = 32 bytes = 64 karakter hex
ABI_WORD_SIZE = 64


# ─── Format Helpers ───────────────────────────────────────────────────────────

def format_address(address: Optional[str], short: bool = True) -> str:
    """
    Format alamat Ethereum untuk display.
    
    Args:
        address: Alamat lengkap (0x...)
        short: Jika True, tampilkan format singkat (0x1234...abcd)
    """
    if not address:
        return "0x0000...0000"
    addr = address.lower()
    if short:
        return f"{addr[:6]}...{addr[-4:]}"
    return addr


def wei_to_eth(wei: int) -> float:
    """Convert Wei ke ETH."""
    return wei / 1e18


def format_value(value_eth: float, eth_price: float = 3400.0) -> dict:
    """
    Format nilai ETH menjadi dict dengan berbagai unit.
    
    Returns:
        {eth: float, usd: float, display: str}
    """
    usd = value_eth * eth_price
    if value_eth >= 1000:
        display = f"{value_eth:,.0f} ETH"
    elif value_eth >= 1:
        display = f"{value_eth:.2f} ETH"
    elif value_eth >= 0.001:
        display = f"{value_eth:.4f} ETH"
    else:
        display = f"{value_eth:.6f} ETH"
    return {"eth": round(value_eth, 6), "usd": round(usd, 2), "display": display}


def format_token_amount(raw_amount: int, decimals: int, symbol: str) -> dict:
    """Format jumlah token dengan desimal yang benar."""
    amount = raw_amount / (10 ** decimals)
    if amount >= 1_000_000:
        display = f"{amount/1_000_000:.2f}M {symbol}"
    elif amount >= 1_000:
        display = f"{amount:,.0f} {symbol}"
    else:
        display = f"{amount:.2f} {symbol}"
    return {"amount": round(amount, 4), "display": display}


# ─── Method ID Decoding ───────────────────────────────────────────────────────

def decode_method_id(input_hex: str) -> dict:
    """
    Decode 4 byte pertama dari input data untuk mengidentifikasi fungsi yang dipanggil.
    
    Args:
        input_hex: Field 'input' dari transaksi (hex string)
        
    Returns:
        {method_id: str, method_name: str, is_known: bool}
    """
    if not input_hex or input_hex == "0x":
        return {
            "method_id": "0x",
            "method_name": "ETH Transfer (Native)",
            "is_known": True,
        }

    # Pastikan ada prefix 0x
    if not input_hex.startswith("0x"):
        input_hex = "0x" + input_hex

    method_id = input_hex[:10].lower()  # 4 bytes = 8 hex chars + '0x'
    method_name = ERC20_METHOD_IDS.get(method_id, f"Unknown ({method_id})")

    return {
        "method_id": method_id,
        "method_name": method_name,
        "is_known": method_id in ERC20_METHOD_IDS,
    }


# ─── ABI Parameter Decoding ───────────────────────────────────────────────────

def _decode_address_param(word: str) -> str:
    """
    Decode satu ABI word (32 bytes) sebagai address.
    ABI encoding padding address dengan 12 byte nol di kiri.
    """
    # Ambil 20 byte terakhir (40 hex chars) = Ethereum address
    return "0x" + word[-40:].lower()


def _decode_uint256_param(word: str) -> int:
    """Decode satu ABI word (32 bytes) sebagai uint256."""
    try:
        return int(word, 16)
    except ValueError:
        return 0


def decode_erc20_transfer(input_hex: str) -> Optional[dict]:
    """
    Decode function call: transfer(address _to, uint256 _value)
    Method ID: 0xa9059cbb
    
    Layout setelah method ID (4 bytes):
    - Word 1 (bytes 4-35): address _to (32 bytes, padded)
    - Word 2 (bytes 36-67): uint256 _value (32 bytes)
    
    Returns:
        {to: str, amount_raw: int} atau None jika bukan transfer
    """
    if not input_hex or len(input_hex) < 10:
        return None

    clean = input_hex.replace("0x", "").lower()
    method_id = "0x" + clean[:8]

    if method_id != "0xa9059cbb":
        return None

    # Data setelah method ID
    data = clean[8:]
    if len(data) < ABI_WORD_SIZE * 2:
        return None

    to_word = data[:ABI_WORD_SIZE]
    amount_word = data[ABI_WORD_SIZE : ABI_WORD_SIZE * 2]

    to_address = _decode_address_param(to_word)
    amount_raw = _decode_uint256_param(amount_word)

    return {"to": to_address, "amount_raw": amount_raw}


def decode_erc20_transfer_from(input_hex: str) -> Optional[dict]:
    """
    Decode: transferFrom(address _from, address _to, uint256 _value)
    Method ID: 0x23b872dd
    
    Layout:
    - Word 1: address _from
    - Word 2: address _to
    - Word 3: uint256 _value
    """
    if not input_hex or len(input_hex) < 10:
        return None

    clean = input_hex.replace("0x", "").lower()
    method_id = "0x" + clean[:8]

    if method_id != "0x23b872dd":
        return None

    data = clean[8:]
    if len(data) < ABI_WORD_SIZE * 3:
        return None

    from_address = _decode_address_param(data[:ABI_WORD_SIZE])
    to_address = _decode_address_param(data[ABI_WORD_SIZE : ABI_WORD_SIZE * 2])
    amount_raw = _decode_uint256_param(data[ABI_WORD_SIZE * 2 : ABI_WORD_SIZE * 3])

    return {"from": from_address, "to": to_address, "amount_raw": amount_raw}


def decode_erc20_log(log: dict) -> Optional[dict]:
    """
    Decode ERC-20 Transfer event dari transaction receipt log.
    
    ERC-20 Transfer event signature:
    event Transfer(address indexed from, address indexed to, uint256 value)
    
    Topics layout:
    - topics[0]: event signature hash (0xddf252ad...)
    - topics[1]: from address (indexed, padded to 32 bytes)
    - topics[2]: to address (indexed, padded to 32 bytes)
    Data:
    - data: uint256 value (non-indexed)
    """
    ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

    topics = log.get("topics", [])
    if not topics or len(topics) < 3:
        return None
    if topics[0].lower() != ERC20_TRANSFER_TOPIC:
        return None

    contract_address = log.get("address", "").lower()
    from_address = _decode_address_param(topics[1].replace("0x", ""))
    to_address = _decode_address_param(topics[2].replace("0x", ""))
    data = log.get("data", "0x").replace("0x", "")
    amount_raw = _decode_uint256_param(data) if len(data) == 64 else 0

    # Cari info token
    token_info = KNOWN_TOKENS.get(contract_address)
    if token_info:
        token_amount = format_token_amount(
            amount_raw, token_info["decimals"], token_info["symbol"]
        )
    else:
        token_amount = {
            "amount": amount_raw / 1e18,
            "display": f"{amount_raw / 1e18:.4f} ???",
        }

    return {
        "contract": contract_address,
        "from": from_address,
        "to": to_address,
        "amount_raw": amount_raw,
        "token": token_info,
        "token_amount": token_amount,
    }


# ─── Transaction Type Classifier ─────────────────────────────────────────────

def classify_transaction(tx: dict, eth_value: float) -> str:
    """
    Mengklasifikasikan jenis transaksi berdasarkan konten.
    
    Returns satu dari:
    - 'eth_transfer': Transfer ETH langsung antar wallet
    - 'erc20_transfer': Pemindahan token ERC-20
    - 'contract_creation': Deploy smart contract baru
    - 'contract_call': Interaksi dengan smart contract (swap, DeFi, dll)
    - 'whale_eth': Transfer ETH skala besar
    - 'whale_erc20': Transfer token skala besar
    """
    input_data = tx.get("input", "0x")
    to_address = tx.get("to")

    # Contract creation: tidak ada 'to' address
    if not to_address:
        return "contract_creation"

    method = decode_method_id(input_data)
    method_id = method["method_id"]

    if method_id == "0x":
        # Pure ETH transfer
        if eth_value >= 50.0:
            return "whale_eth"
        return "eth_transfer"

    if method_id == "0xa9059cbb" or method_id == "0x23b872dd":
        return "erc20_transfer"

    # Semua contract call lainnya
    return "contract_call"


# ─── Utility ─────────────────────────────────────────────────────────────────

def hex_to_int(hex_str: str) -> int:
    """Convert hex string ke int."""
    if not hex_str:
        return 0
    return int(hex_str, 16)


def gwei_from_hex(hex_gas_price: str) -> float:
    """Convert hex gas price ke Gwei."""
    return hex_to_int(hex_gas_price) / 1e9
