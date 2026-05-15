"""
COT Multi-Asset Data & Analisis Prediksi (Tanpa Visual)
- Fetch data COT
- Simpan CSV
- Tampilkan ringkasan posisi dan prediksi per aset
"""

import cot_reports as cot
import pandas as pd
import sys
import io
from datetime import datetime
from typing import Dict, List, Optional

# Fix Windows cp1252 encoding issue
# Use reconfigure() — safe even under uvicorn where .buffer may be absent
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass  # Not available in all stream wrappers; fall back to ASCII replacement


# ══════════════════════════════════════════════════════════════
# ASSET REGISTRY
# ══════════════════════════════════════════════════════════════

ASSET_REGISTRY = {
    "GOLD":       "GOLD - COMMODITY EXCHANGE INC.",
    "SILVER":     "SILVER - COMMODITY EXCHANGE INC.",
    "COPPER":     "COPPER- #1 - COMMODITY EXCHANGE INC.",
    "PLATINUM":   "PLATINUM - NEW YORK MERCANTILE EXCHANGE",
    "PALLADIUM":  "PALLADIUM - NEW YORK MERCANTILE EXCHANGE",
    "CRUDE_OIL":  "CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE",
    "NAT_GAS":    "NATURAL GAS - NEW YORK MERCANTILE EXCHANGE",
    "BRENT":      "BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE",
    "RBOB_GAS":   "RBOB GASOLINE - NEW YORK MERCANTILE EXCHANGE",
    "ES":         "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
    "NQ":         "E-MINI NASDAQ-100 - CHICAGO MERCANTILE EXCHANGE",
    "YM":         "E-MINI DOW ($5) - CHICAGO BOARD OF TRADE",
    "RTY":        "E-MINI RUSSELL 2000 INDEX - CHICAGO MERCANTILE EXCHANGE",
    "EUR":        "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    "JPY":        "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",
    "GBP":        "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE",
    "CHF":        "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE",
    "CAD":        "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
    "AUD":        "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
    "NZD":        "NEW ZEALAND DOLLAR - CHICAGO MERCANTILE EXCHANGE",
    "MXN":        "MEXICAN PESO - CHICAGO MERCANTILE EXCHANGE",
    "USD_IDX":    "U.S. DOLLAR INDEX - ICE FUTURES U.S.",
    "T_BOND":     "U.S. TREASURY BONDS - CHICAGO BOARD OF TRADE",
    "T_NOTE_10":  "10-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE",
    "T_NOTE_5":   "5-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE",
    "FED_FUNDS":  "FED FUNDS - CHICAGO BOARD OF TRADE",
    "SOFR":       "3-MONTH SOFR - CHICAGO MERCANTILE EXCHANGE",
    "CORN":       "CORN - CHICAGO BOARD OF TRADE",
    "SOYBEANS":   "SOYBEANS - CHICAGO BOARD OF TRADE",
    "WHEAT":      "WHEAT-SRW - CHICAGO BOARD OF TRADE",
    "SUGAR":      "SUGAR NO. 11 - ICE FUTURES U.S.",
    "COFFEE":     "COFFEE C - ICE FUTURES U.S.",
    "COCOA":      "COCOA - ICE FUTURES U.S.",
    "COTTON":     "COTTON NO. 2 - ICE FUTURES U.S.",
    "LIVE_CATTLE":"LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "LEAN_HOGS":  "LEAN HOGS - CHICAGO MERCANTILE EXCHANGE",
    "BTC":        "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
    "ETH":        "ETHER - CHICAGO MERCANTILE EXCHANGE",
}


# ══════════════════════════════════════════════════════════════
# DATA LAYER
# ══════════════════════════════════════════════════════════════

class COTFetcher:
    """Download & cache raw COT data."""

    def __init__(self, report_type: str = 'legacy_fut'):
        self.report_type = report_type
        self._cache: Dict[tuple, Optional[pd.DataFrame]] = {}

    def _download_year(self, year: int) -> Optional[pd.DataFrame]:
        key = (year, self.report_type)
        if key not in self._cache:
            try:
                raw = cot.cot_year(year, cot_report_type=self.report_type)
                raw.columns = raw.columns.str.strip().str.lower().str.replace(' ', '_')
                self._cache[key] = raw
            except Exception as e:
                print(f"   [FAIL] Download {year}: {e}")
                self._cache[key] = None
        return self._cache[key]

    def _extract(self, raw: pd.DataFrame, exact_name: str) -> Optional[pd.DataFrame]:
        if 'market_and_exchange_names' not in raw.columns:
            return None

        df = raw[raw['market_and_exchange_names'].str.strip().str.upper() == exact_name.upper()].copy()
        if df.empty:
            return None

        # Deteksi kolom tanggal
        if 'report_date_as_yyyy_mm_dd' in df.columns:
            df['date'] = pd.to_datetime(df['report_date_as_yyyy_mm_dd'])
        elif 'as_of_date_in_form_yymmdd' in df.columns:
            df['date'] = pd.to_datetime(df['as_of_date_in_form_yymmdd'], format='%y%m%d')
        else:
            return None

        cols = ['date', 'market_and_exchange_names']
        patterns = {
            'Open_Interest':     ['open_interest'],
            'HedgeFund_Long':    ['noncommercial_positions', 'long'],
            'HedgeFund_Short':   ['noncommercial_positions', 'short'],
            'Commercial_Long':   ['commercial_positions', 'long'],
            'Commercial_Short':  ['commercial_positions', 'short'],
        }
        for new_name, keywords in patterns.items():
            for col in df.columns:
                if all(kw in col for kw in keywords):
                    df = df.rename(columns={col: new_name})
                    cols.append(new_name)
                    break

        required = set(patterns.keys())
        if not required.issubset(set(cols)):
            return None

        return df[cols].sort_values('date').reset_index(drop=True)

    def fetch(self, asset_key: str, start_year: int, end_year: int) -> Optional[pd.DataFrame]:
        exact = ASSET_REGISTRY.get(asset_key.upper())
        if not exact:
            return None

        frames = []
        for year in range(start_year, end_year + 1):
            raw = self._download_year(year)
            if raw is not None:
                df_y = self._extract(raw, exact)
                if df_y is not None:
                    frames.append(df_y)

        if not frames:
            return None

        return (pd.concat(frames, ignore_index=True)
                .drop_duplicates('date')
                .sort_values('date')
                .reset_index(drop=True))


class COTProcessor:
    """Resample weekly & hitung derived metrics."""

    @staticmethod
    def weekly(df: pd.DataFrame, freq: str = 'W-FRI') -> pd.DataFrame:
        df = df.drop_duplicates('date').set_index('date').sort_index()
        num_cols = df.select_dtypes('number').columns.tolist()
        str_cols = [c for c in df.columns if c not in num_cols]

        df_num = df[num_cols].resample(freq).last()
        df_str = df[str_cols].resample(freq).last() if str_cols else pd.DataFrame(index=df_num.index)
        out = pd.concat([df_num, df_str], axis=1)

        out['is_filled'] = out[num_cols[0]].isna() if num_cols else False
        out[num_cols] = out[num_cols].ffill(limit=2)
        out[str_cols] = out[str_cols].ffill(limit=2)
        out = out.dropna(subset=num_cols[:1]).reset_index()
        out['date'] = pd.to_datetime(out['date'])
        return out

    @staticmethod
    def metrics(df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        df['HedgeFund_Net']  = df['HedgeFund_Long']  - df['HedgeFund_Short']
        df['Commercial_Net'] = df['Commercial_Long'] - df['Commercial_Short']
        df['HF_Net_PctOI']   = (df['HedgeFund_Net']  / df['Open_Interest'] * 100).round(2)
        df['Comm_Net_PctOI'] = (df['Commercial_Net'] / df['Open_Interest'] * 100).round(2)

        def idx(s, w=52):
            mn = s.rolling(w, min_periods=4).min()
            mx = s.rolling(w, min_periods=4).max()
            return ((s - mn) / (mx - mn).replace(0, pd.NA) * 100).round(2)

        df['HF_COT_Index']   = idx(df['HedgeFund_Net'])
        df['Comm_COT_Index'] = idx(df['Commercial_Net'])

        df['COT_Bias'] = df['HF_COT_Index'].apply(
            lambda x: 'BULLISH' if pd.notna(x) and x >= 75 else ('BEARISH' if pd.notna(x) and x <= 25 else 'NEUTRAL')
        )

        # Week-over-week changes
        base_cols = ['HedgeFund_Net', 'Commercial_Net', 'Open_Interest',
                     'HedgeFund_Long', 'HedgeFund_Short', 'Commercial_Long', 'Commercial_Short']
        for col in base_cols:
            if col in df.columns:
                df[f'{col}_WoW'] = df[col].diff().round(2)
        return df


# ==============================================================
# ORCHESTRATOR & ANALISIS
# ==============================================================

class COTAnalyzer:
    def __init__(self, report_type: str = 'legacy_fut'):
        self.fetcher = COTFetcher(report_type)
        self.processor = COTProcessor()
        self.data: Dict[str, pd.DataFrame] = {}

    def run(self, keys: List[str], start_year: int, end_year: Optional[int] = None,
            verbose: bool = True) -> Dict[str, pd.DataFrame]:
        end_year = end_year or datetime.now().year
        self.data.clear()
        total = len(keys)
        print(f"\n{'='*60}")
        print(f"  COT FETCH | {total} assets | {start_year}-{end_year}")
        print(f"{'='*60}")

        for i, k in enumerate(keys, 1):
            ku = k.upper()
            if ku not in ASSET_REGISTRY:
                print(f"[{i:>2}/{total}] SKIP '{k}'.")
                continue
            if verbose:
                print(f"[{i:>2}/{total}] >> {ku}")

            raw = self.fetcher.fetch(ku, start_year, end_year)
            if raw is None:
                print(f"         [NO DATA]")
                continue

            wk = self.processor.weekly(raw)
            needed = ['HedgeFund_Long', 'HedgeFund_Short', 'Commercial_Long', 'Commercial_Short', 'Open_Interest']
            if any(col not in wk.columns for col in needed):
                print(f"         [INCOMPLETE] Skipping.")
                continue

            fin = self.processor.metrics(wk)
            self.data[ku] = fin

            if verbose:
                bias = fin['COT_Bias'].iloc[-1]
                hf_i = fin['HF_COT_Index'].iloc[-1]
                print(f"         [OK] {len(raw)} raw -> {len(wk)} wks | Bias: {bias} | Idx: {hf_i:.1f}")

        print(f"\n[*] {len(self.data)}/{total} aset OK.\n")
        return self.data

    def save_csv(self, prefix: str = "COT") -> None:
        for k, df in self.data.items():
            df.to_csv(f"{prefix}_{k}.csv", index=False)
        print(f"[*] {len(self.data)} CSV saved.")

    def analisis_terbaru(self) -> pd.DataFrame:
        """
        Mengembalikan DataFrame ringkasan data terbaru untuk semua aset,
        dilengkapi dengan prediksi arah berdasarkan COT Bias & Indeks.
        """
        _COLUMNS = [
            'Asset', 'Date', 'OI', 'HF_Long', 'HF_Short', 'HF_Net',
            'Comm_Long', 'Comm_Short', 'Comm_Net', 'HF_Net_%OI',
            'Comm_Net_%OI', 'HF_COT_Index', 'Comm_COT_Index', 'Bias', 'Signal',
        ]
        rows = []
        for k, df in self.data.items():
            if df.empty:
                continue
            latest = df.iloc[-1]
            rows.append({
                'Asset': k,
                'Date': latest['date'],
                'OI': latest['Open_Interest'],
                'HF_Long': latest['HedgeFund_Long'],
                'HF_Short': latest['HedgeFund_Short'],
                'HF_Net': latest['HedgeFund_Net'],
                'Comm_Long': latest['Commercial_Long'],
                'Comm_Short': latest['Commercial_Short'],
                'Comm_Net': latest['Commercial_Net'],
                'HF_Net_%OI': latest['HF_Net_PctOI'],
                'Comm_Net_%OI': latest['Comm_Net_PctOI'],
                'HF_COT_Index': latest['HF_COT_Index'],
                'Comm_COT_Index': latest['Comm_COT_Index'],
                'Bias': latest['COT_Bias'],
                'Signal': self._signal_recommendation(latest['COT_Bias'], latest['HF_COT_Index']),
            })
        # Guard: return typed empty DataFrame when no data — avoids KeyError on sort_values
        if not rows:
            return pd.DataFrame(columns=_COLUMNS)
        return pd.DataFrame(rows).sort_values('Bias', ascending=False)

    @staticmethod
    def _signal_recommendation(bias: str, hf_idx: float) -> str:
        """
        Memberikan rekomendasi berbasis COT:
        - BULLISH + idx tinggi -> Strong Buy
        - BULLISH saja -> Buy
        - BEARISH + idx rendah -> Strong Sell
        - BEARISH saja -> Sell
        - NEUTRAL -> Hold / Wait
        """
        if bias == 'BULLISH':
            if pd.notna(hf_idx) and hf_idx >= 90:
                return 'STRONG BUY'
            return 'BUY'
        elif bias == 'BEARISH':
            if pd.notna(hf_idx) and hf_idx <= 10:
                return 'STRONG SELL'
            return 'SELL'
        else:
            return 'HOLD / NEUTRAL'


# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════

def main():
    ASSETS = [
        "GOLD", "SILVER", "CRUDE_OIL", "NAT_GAS",
        "ES", "NQ",
        "EUR", "JPY", "GBP", "AUD",
        "BTC",
    ]

    analyzer = COTAnalyzer()
    data = analyzer.run(ASSETS, start_year=2022)
    analyzer.save_csv()

    # Tampilkan analisis prediksi
    if data:
        df_pred = analyzer.analisis_terbaru()
        print("\n" + "="*80)
        print("  PREDIKSI BERDASARKAN COT REPORT TERBARU")
        print("="*80)
        print(df_pred.to_string(index=False))
    else:
        print("Tidak ada data untuk dianalisis.")


if __name__ == "__main__":
    main()