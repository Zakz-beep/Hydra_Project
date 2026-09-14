# python/onchain/rpc_client.py
# Wrapper untuk Ethereum JSON-RPC calls (pure Python, tanpa web3.py)
# Menggunakan urllib.request built-in agar tidak perlu install dependency baru

import json
import time
import logging
import urllib.request
import urllib.error
from typing import Any, Optional

from config import RPC_ENDPOINTS, RPC_TIMEOUT

logger = logging.getLogger(__name__)

# ─── State: track endpoint yang sedang aktif ──────────────────────────────────
_current_endpoint_idx = 0
_endpoint_failures: dict[str, int] = {}
MAX_FAILURES = 3  # Rotasi endpoint setelah N failure berturut-turut


def _get_active_endpoint() -> str:
    global _current_endpoint_idx
    return RPC_ENDPOINTS[_current_endpoint_idx % len(RPC_ENDPOINTS)]


def _rotate_endpoint() -> str:
    global _current_endpoint_idx
    _current_endpoint_idx = (_current_endpoint_idx + 1) % len(RPC_ENDPOINTS)
    new_ep = _get_active_endpoint()
    logger.warning(f"[RPC] Rotasi ke endpoint: {new_ep}")
    return new_ep


def rpc_call(method: str, params: list = [], retries: int = 3) -> Any:
    """
    Melakukan JSON-RPC call ke Ethereum node.
    
    Args:
        method: Nama method RPC (mis. 'eth_blockNumber')
        params: Parameter untuk method tersebut
        retries: Jumlah retry jika gagal
        
    Returns:
        Field 'result' dari response JSON-RPC
        
    Raises:
        RuntimeError: Jika semua retry dan semua endpoint gagal
    """
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }).encode("utf-8")

    last_error = None
    for attempt in range(retries):
        endpoint = _get_active_endpoint()
        try:
            req = urllib.request.Request(
                endpoint,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; VRPDashboard/1.0; +https://github.com/local)",
                    "Origin": "https://app.uniswap.org",
                    "Referer": "https://app.uniswap.org/",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=RPC_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            if "error" in data:
                raise RuntimeError(f"RPC Error: {data['error']}")

            # Reset failure count untuk endpoint ini
            _endpoint_failures[endpoint] = 0
            return data.get("result")

        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_error = e
            logger.warning(
                f"[RPC] Attempt {attempt + 1}/{retries} gagal untuk {endpoint}: {e}"
            )
            _endpoint_failures[endpoint] = _endpoint_failures.get(endpoint, 0) + 1
            if _endpoint_failures.get(endpoint, 0) >= MAX_FAILURES:
                _rotate_endpoint()
            if attempt < retries - 1:
                time.sleep(0.5 * (attempt + 1))  # Exponential backoff ringan

        except (json.JSONDecodeError, KeyError) as e:
            last_error = e
            logger.error(f"[RPC] Parse error dari {endpoint}: {e}")
            if attempt < retries - 1:
                time.sleep(0.3)

    raise RuntimeError(f"Semua RPC attempt gagal untuk {method}: {last_error}")


# ─── Helper Functions ─────────────────────────────────────────────────────────

def hex_to_int(hex_str: str) -> int:
    """Convert hex string (dengan atau tanpa prefix 0x) ke integer."""
    if not hex_str:
        return 0
    return int(hex_str, 16)


def wei_to_eth(wei: int) -> float:
    """Convert Wei (satuan terkecil ETH) ke ETH."""
    return wei / 1e18


def gwei_to_eth(gwei: int) -> float:
    return gwei / 1e9


# ─── Ethereum RPC Methods ─────────────────────────────────────────────────────

def get_latest_block_number() -> int:
    """Mendapatkan nomor blok terbaru yang sudah divalidasi."""
    result = rpc_call("eth_blockNumber")
    return hex_to_int(result)


def get_block(block_number: int, full_transactions: bool = True) -> Optional[dict]:
    """
    Mendapatkan detail blok berikut semua transaksinya.
    
    Args:
        block_number: Nomor blok (integer)
        full_transactions: Jika True, sertakan data transaksi lengkap
        
    Returns:
        Dict berisi data blok, atau None jika tidak ditemukan
    """
    hex_block = hex(block_number)
    result = rpc_call("eth_getBlockByNumber", [hex_block, full_transactions])
    return result


def get_block_by_hash(block_hash: str, full_transactions: bool = True) -> Optional[dict]:
    """Mendapatkan blok berdasarkan hash."""
    return rpc_call("eth_getBlockByHash", [block_hash, full_transactions])


def get_transaction(tx_hash: str) -> Optional[dict]:
    """Mendapatkan detail transaksi berdasarkan hash."""
    return rpc_call("eth_getTransactionByHash", [tx_hash])


def get_transaction_receipt(tx_hash: str) -> Optional[dict]:
    """
    Mendapatkan receipt transaksi (termasuk status sukses/gagal dan event logs).
    Receipt hanya ada setelah transaksi dimasukkan ke blok.
    """
    return rpc_call("eth_getTransactionReceipt", [tx_hash])


def get_balance(address: str, block: str = "latest") -> float:
    """
    Mendapatkan saldo ETH suatu alamat dalam satuan ETH.
    
    Args:
        address: Ethereum address (0x...)
        block: 'latest', 'earliest', atau hex block number
    """
    result = rpc_call("eth_getBalance", [address.lower(), block])
    wei = hex_to_int(result)
    return wei_to_eth(wei)


def get_gas_price() -> float:
    """Mendapatkan harga gas saat ini dalam Gwei."""
    result = rpc_call("eth_gasPrice")
    gwei = hex_to_int(result) / 1e9
    return round(gwei, 2)


def get_chain_id() -> int:
    """Mendapatkan chain ID (1 = Ethereum Mainnet)."""
    result = rpc_call("eth_chainId")
    return hex_to_int(result)


def get_tx_count(address: str) -> int:
    """Mendapatkan jumlah transaksi yang pernah dikirim oleh alamat ini (nonce)."""
    result = rpc_call("eth_getTransactionCount", [address.lower(), "latest"])
    return hex_to_int(result)


def get_code(address: str) -> str:
    """
    Mendapatkan bytecode di alamat ini.
    Jika '0x' atau kosong → EOA (Externally Owned Account / dompet biasa).
    Jika ada kode → Smart Contract.
    """
    return rpc_call("eth_getCode", [address.lower(), "latest"]) or "0x"


def is_contract(address: str) -> bool:
    """Cek apakah alamat ini adalah smart contract."""
    code = get_code(address)
    return code not in ("0x", "0x0", "", None)


def get_logs(
    from_block: int,
    to_block: int,
    address: Optional[str] = None,
    topics: Optional[list] = None,
) -> list:
    """
    Mengambil event logs dari rentang blok tertentu.
    Berguna untuk memantau Transfer events ERC-20 secara efisien.
    
    Topics untuk ERC20 Transfer event:
    - topics[0]: 0xddf252ad... (keccak256 dari "Transfer(address,address,uint256)")
    """
    params: dict = {
        "fromBlock": hex(from_block),
        "toBlock": hex(to_block),
    }
    if address:
        params["address"] = address.lower()
    if topics:
        params["topics"] = topics

    return rpc_call("eth_getLogs", [params]) or []


# ─── ERC-20 Transfer Event Topic ─────────────────────────────────────────────
# keccak256("Transfer(address,address,uint256)")
ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
