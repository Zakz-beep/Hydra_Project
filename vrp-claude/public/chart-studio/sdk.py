"""Chart Studio Python SDK. All data is a snapshot; UTC timestamps in seconds."""
import json
import math
import re
import traceback
import pandas as pd
import numpy as np


class Inputs:
    def __init__(self, values):
        self.values, self.definitions = values, []

    def float(self, name, default=1.0, min=-1e9, max=1e9, step=0.1):
        value = float(self.values.get(name, default))
        if not math.isfinite(value) or not min <= value <= max:
            raise ValueError(f"{name} must be between {min} and {max}")
        self.definitions.append(dict(name=name, value=value, min=min, max=max, step=step))
        return value

    def int(self, name, default=20, min=1, max=10000):
        value = self.float(name, default, min, max, 1)
        if value != int(value):
            raise ValueError(f"{name} must be an integer")
        return int(value)


class Data:
    def __init__(self, payload):
        self.datasets = payload

    def ohlcv(self, name="chart"):
        if name not in self.datasets:
            raise ValueError(f"Dataset '{name}' unavailable. Add it in Data inputs before Run.")
        frame = pd.DataFrame(self.datasets[name]).copy()
        frame.index = pd.to_datetime(frame["time"], unit="s", utc=True)
        return frame


class Plots:
    def __init__(self, frame):
        self.frame, self.outputs = frame, []

    def _add(self, ident, kind, values, pane="price", color="#45c9b0", title=None, **extra):
        if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValueError("Use a six-digit hex color, for example #45c9b0")
        if len(self.outputs) >= 32:
            raise ValueError("Maximum 32 outputs per indicator")
        if any(p["id"] == str(ident) for p in self.outputs):
            raise ValueError(f"Duplicate output ID: {ident}")
        if pane != "price" and len(set(p["pane"] for p in self.outputs) | {pane}) > 5:
            raise ValueError("Maximum four indicator panes")
        if values is None:
            data = []
        else:
            series = values if isinstance(values, pd.Series) else pd.Series(values, index=self.frame.index)
            if not isinstance(series.index, pd.DatetimeIndex):
                if len(series) != len(self.frame):
                    raise ValueError("Use a UTC DatetimeIndex when output length differs from candles")
                series.index = self.frame.index
            if len(series) > 20000:
                raise ValueError("Maximum 20,000 values per output")
            data = []
            for date, value in series.items():
                number = None if pd.isna(value) else float(value)
                if number is not None and not math.isfinite(number):
                    raise ValueError(f"{ident} contains infinity")
                data.append(dict(time=int(date.timestamp()), value=number))
            data = sorted({d["time"]: d for d in data}.values(), key=lambda d: d["time"])
        self.outputs.append(dict(id=str(ident), kind=kind, pane=str(pane), color=color,
                                 title=title or str(ident), data=data, **extra))

    def line(self, ident, values, **options):
        self._add(ident, "line", values, **options)

    def histogram(self, ident, values, **options):
        self._add(ident, "histogram", values, **options)

    def area(self, ident, values, **options):
        self._add(ident, "area", values, **options)

    def hline(self, ident, value, **options):
        if not math.isfinite(float(value)):
            raise ValueError("Horizontal line value must be finite")
        self._add(ident, "hline", None, value=float(value), **options)

    def marker(self, ident, condition, text="Signal", **options):
        mask = pd.Series(condition, index=self.frame.index).fillna(False).astype(bool)
        self._add(ident, "marker", self.frame.close[mask], **options)
        for point in self.outputs[-1]["data"]:
            point["text"] = str(text)[:100]

    def box(self, ident, start, end, top, bottom, **options):
        def timestamp(v):
            return int(v.timestamp()) if hasattr(v, "timestamp") else int(v)
        if not all(math.isfinite(float(v)) for v in [top, bottom]) or top < bottom:
            raise ValueError("Box requires finite top >= bottom")
        if timestamp(end) < timestamp(start):
            raise ValueError("Box end must not precede its start")
        self._add(ident, "box", None, value=timestamp(start), endTime=timestamp(end), top=float(top), bottom=float(bottom), **options)


class GreeksData:
    def __init__(self, payload):
        self.payload = payload

    @property
    def meta(self):
        if not self.payload:
            raise ValueError("Enable The Greeks data input and choose an options ticker before Run.")
        return dict(self.payload["meta"])

    def snapshot(self, allow_synthetic=False):
        meta = self.meta
        snapshot = self.payload.get("snapshot")
        if meta.get("replay") or not snapshot:
            raise ValueError("Current Greeks snapshot is unavailable in replay. Use ctx.greeks.history().")
        if meta.get("source") != "live" and not allow_synthetic:
            raise ValueError("Greeks source is mixed/synthetic. Live data required by default; only explicitly opt into synthetic data for experiments.")
        return dict(snapshot)

    def chain(self, allow_synthetic=False):
        self.snapshot(allow_synthetic)
        frame = pd.DataFrame(self.payload.get("chain", []))
        if frame.empty:
            raise ValueError("No option contracts in the supplied Greeks snapshot.")
        return frame.copy()

    def history(self, allow_synthetic=False):
        meta = self.meta
        rows = [r for r in self.payload.get("history", [])
                if (allow_synthetic or r.get("data_source") == "live")
                and float(r["time"]) <= float(meta.get("cutoff", meta["observed_at"]))]
        if not rows:
            raise ValueError("No eligible stored Greeks history for this time. Collect snapshots first; history is never fabricated.")
        frame = pd.DataFrame(rows)
        frame.index = pd.to_datetime(frame["time"], unit="s", utc=True)
        return frame.sort_index().loc[lambda df: ~df.index.duplicated(keep="last")].copy()

    def oi_changes(self, allow_synthetic=False):
        self.snapshot(allow_synthetic)
        return pd.DataFrame(self.payload.get("oi_changes", [])).copy()


class Context:
    def __init__(self, payload):
        self.data = Data(payload["datasets"])
        self.input = Inputs(payload.get("params", {}))
        self.plot = Plots(self.data.ohlcv())
        self.draw = self.plot
        self.symbol = payload["symbol"]
        self.timeframe = payload["interval"]
        self.market = payload.get("market") or {}  # Latest snapshot only; empty in replay.
        self.greeks = GreeksData(payload.get("greeks"))


def execute_indicator(code, payload):
    ctx = Context(payload)
    namespace = {"pd": pd, "np": np, "__name__": "__indicator__"}
    exec(compile(code, "indicator.py", "exec"), namespace)
    if not callable(namespace.get("calculate")):
        raise ValueError("Define calculate(ctx) in your script")
    namespace["calculate"](ctx)
    if not ctx.plot.outputs:
        raise ValueError("No plots produced. Use ctx.plot.line / histogram / area / hline / marker / box.")
    return json.dumps(dict(plots=ctx.plot.outputs, inputs=ctx.input.definitions), allow_nan=False)


def studio_request(code, payload=None, validate=False):
    """Return source diagnostics without exposing Pyodide's internal stack as the headline.

    Validation only compiles: it does not import packages, construct a context or run code.
    Keep execute_indicator available for existing SDK callers.
    """
    try:
        compile(code, "indicator.py", "exec")
        if validate:
            return json.dumps({"valid": True})
        return json.dumps({"result": json.loads(execute_indicator(code, payload))})
    except BaseException as error:
        line, column = None, None
        if isinstance(error, SyntaxError) and error.filename == "indicator.py":
            line, column = error.lineno, error.offset
        else:
            for frame in traceback.extract_tb(error.__traceback__):
                if frame.filename == "indicator.py":
                    line = frame.lineno
        lines = code.splitlines()
        return json.dumps({"error": {
            "type": type(error).__name__, "message": str(error)[:4000],
            "line": line, "column": column,
            "source": lines[line - 1] if line and 0 < line <= len(lines) else None,
            "traceback": "".join(traceback.format_exception(error))[-16000:]
        }})
