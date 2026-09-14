"""Read-only Chart Studio adapter; legacy naive dates use the backend's local timezone."""
from datetime import datetime, timezone
import math


def epoch_seconds(value):
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).timestamp()
    except (ValueError, TypeError, OverflowError):
        return None


def chart_payload(snapshot, history, oi_changes, observed_at, contract_size=100, risk_free_rate=0.0525):
    chain = []
    seen = set()
    for bucket, inventory in snapshot.get("by_expiry", {}).items():
        for row in inventory.get("strikes", []):
            key = (row.get("expiry"), row.get("option_type"), row.get("strike"))
            if key in seen:
                continue
            seen.add(key)
            chain.append({**row, "bucket": bucket})
    clean_history = []
    for row in history:
        seconds = epoch_seconds(row.get("timestamp"))
        if seconds is not None and math.isfinite(seconds) and seconds <= observed_at:
            clean_history.append({**row, "time": seconds})
    compact = {**snapshot, "by_expiry": {
        key: {k: v for k, v in inv.items() if k != "strikes"}
        for key, inv in snapshot.get("by_expiry", {}).items()
    }}
    return {
        "snapshot": compact, "chain": chain,
        "history": sorted(clean_history, key=lambda r: r["time"]),
        "oi_changes": oi_changes,
        "meta": {
            "ticker": snapshot.get("ticker"), "observed_at": observed_at,
            "snapshot_time": epoch_seconds(snapshot.get("timestamp")),
            "source": snapshot.get("data_source"), "contract_size": contract_size,
            "risk_free_rate": risk_free_rate, "history_time_basis": "Legacy naive timestamps interpreted in backend local timezone, then UTC",
            "history_scope": "Latest stored aggregate snapshots; not candle-by-candle history",
            "chain_scope": "Engine-filtered expiries and contracts; not the entire exchange chain",
            "oi_change_scope": "Archived top-GEX contracts only; partial coverage and snapshot comparisons",
            "flow_basis": "Option-chain volume and OI; no aggressor side, sweep or block identification",
            "gex_usd_per_1pct_multiplier": 1e7,
        },
    }
