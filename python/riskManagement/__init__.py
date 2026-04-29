"""
riskManagement package
======================
Full Risk Management Pipeline — Phase 2 to Phase 6.
"""

import os
import sys

# Ensure riskManagement dir is on sys.path so intra-package
# bare imports (e.g. "from phase3_simulation import ...") work
# regardless of whether we run from inside or outside the directory.
_pkg_dir = os.path.dirname(os.path.abspath(__file__))
if _pkg_dir not in sys.path:
    sys.path.insert(0, _pkg_dir)
