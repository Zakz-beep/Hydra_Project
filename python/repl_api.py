"""Retired insecure REPL service.

The former endpoint executed request-controlled Python without authentication or
an operating-system sandbox. It is intentionally unavailable. Build explicit,
allowlisted analytics endpoints instead of restoring arbitrary code execution.
"""

raise RuntimeError(
    "repl_api has been permanently retired because it exposed arbitrary code execution"
)
