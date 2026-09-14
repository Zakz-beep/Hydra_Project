"""Asia / London / New York sessions for Chart Studio calculate(ctx).

Import this .py in Python Studio, Run, then open indicator Inputs / Style.
Default windows are configurable analysis sessions, NOT exchange calendars.
Asia means Tokyo. Hours use each city's local timezone; London/NY adjust for DST.
Use 1m, 5m, 15m or 1h. Only candles fully contained in a session contribute.
Boxes summarize observed ranges (their past height changes as a session develops).
Optional high/low lines are expanding, causal values. No future prices are read.
"""
import pandas as pd


# Edit these colors/timezones here, or change individual plot colors in Style.
SESSIONS = (
    ("asia", "Asia", "Asia/Tokyo", 900, 1800, "#a78bfa"),
    ("london", "London", "Europe/London", 800, 1700, "#38bdf8"),
    ("new_york", "New York", "America/New_York", 800, 1700, "#fbbf24"),
)


def _minutes(hhmm, name):
    hour, minute = divmod(hhmm, 100)
    if hour > 23 or minute > 59:
        raise ValueError(f"{name}: use HHMM, for example 800 or 1330 (00:00–23:59).")
    return hour * 60 + minute


def _boundary(day, minute, timezone):
    # For custom hours in DST transition gaps: move to the first valid clock time.
    # For repeated autumn hours: choose the standard-time occurrence.
    return (day + pd.Timedelta(minutes=minute)).tz_localize(
        timezone, ambiguous=False, nonexistent="shift_forward"
    ).tz_convert("UTC")


def _groups(bars, timezone, start_minute, end_minute, duration, count, weekends):
    local_days = bars.index.tz_convert(timezone).tz_localize(None).normalize()
    days = local_days.unique().union(local_days.unique() - pd.Timedelta(days=1))
    groups = []
    for day in days.sort_values(ascending=False):
        if not weekends and day.weekday() >= 5:
            continue
        start = _boundary(day, start_minute, timezone)
        end_day = day + pd.Timedelta(days=int(end_minute < start_minute))
        end = _boundary(end_day, end_minute, timezone)
        selected = bars.loc[(bars.index >= start) & (bars.index + duration <= end)]
        if selected.empty:
            continue
        groups.append((day, start, end, selected))
        if len(groups) >= count:
            break
    return groups


def calculate(ctx):
    interval = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600}.get(ctx.timeframe)
    if not interval:
        raise ValueError("Market Sessions requires 1m, 5m, 15m or 1h candles. Switch timeframe and Run again.")
    bars = ctx.data.ohlcv().sort_index()
    bars = bars.loc[~bars.index.duplicated(keep="last")]
    if bars.empty:
        raise ValueError("Load intraday candles before running Market Sessions.")
    duration = pd.Timedelta(seconds=interval)
    count = ctx.input.int("sessions_per_market", 5, 1, 6)
    weekends = ctx.input.int("include_weekends", 0, 0, 1)
    show_boxes = ctx.input.int("show_boxes", 1, 0, 1)
    show_ranges = ctx.input.int("show_running_high_low", 0, 0, 1)
    show_open = ctx.input.int("show_session_open", 0, 0, 1)
    show_labels = ctx.input.int("show_labels", 1, 0, 1)
    output_count = 0
    print("Session windows use local city time; London/New York DST adjusts automatically.")
    print("Only available, fully contained candles count. Boxes summarize observed ranges; holidays are not filtered.")

    for key, name, timezone, default_start, default_end, color in SESSIONS:
        enabled = ctx.input.int(f"{key}_enabled", 1, 0, 1)
        start_hhmm = ctx.input.int(f"{key}_start_hhmm", default_start, 0, 2359)
        end_hhmm = ctx.input.int(f"{key}_end_hhmm", default_end, 0, 2359)
        start_minute = _minutes(start_hhmm, f"{name} start")
        end_minute = _minutes(end_hhmm, f"{name} end")
        if start_minute == end_minute:
            raise ValueError(f"{name}: start and end must differ. Overnight sessions are supported.")
        if not enabled:
            continue

        groups = _groups(bars, timezone, start_minute, end_minute, duration, count, weekends)
        high = pd.Series(float("nan"), index=bars.index)
        low, opening = high.copy(), high.copy()
        labels = pd.Series(False, index=bars.index)
        for rank, (day, start, end, selected) in enumerate(groups):
            high.loc[selected.index] = selected.high.cummax()
            low.loc[selected.index] = selected.low.cummin()
            opening.loc[selected.index] = float(selected.open.iloc[0])
            # A missing opening candle is not mislabeled as the session open.
            if selected.index[0] == start:
                labels.loc[start] = True
            else:
                opening.loc[selected.index] = float("nan")
            top, bottom = float(selected.high.max()), float(selected.low.min())
            if show_boxes:
                ctx.plot.box(
                    f"{key}_zone_{rank}", selected.index[0], selected.index[-1] + duration,
                    top, bottom, color=color, title=f"{name} · {day:%d %b}",
                )
                output_count += 1
            if rank == 0:
                expected = int((end - start) / duration)
                status = "complete coverage" if len(selected) == expected and selected.index[0] == start and selected.index[-1] + duration == end else "partial coverage"
                print(f"{name} {day:%Y-%m-%d} | {timezone} {start_hhmm:04d}–{end_hhmm:04d} | "
                      f"UTC {start:%H:%M}–{end:%H:%M} | H {top:g} L {bottom:g} | "
                      f"Range {top-bottom:g} | {len(selected)} bars, {status}")
        if not groups:
            print(f"{name}: no candles in the selected window. Try more intraday history or include_weekends=1 for crypto.")
        if show_ranges:
            ctx.plot.line(f"{key}_high", high, color=color, title=f"{name} running high")
            ctx.plot.line(f"{key}_low", low, color=color, title=f"{name} running low")
            output_count += 2
        if show_open:
            ctx.plot.line(f"{key}_open", opening, color=color, title=f"{name} open")
            output_count += 1
        if show_labels:
            ctx.plot.marker(f"{key}_labels", labels, text=name, color=color, title=f"{name} session start")
            output_count += 1

    # Empty output is valid even when all sessions are disabled or data is absent.
    if not output_count:
        ctx.plot.line("sessions_empty", pd.Series(float("nan"), index=bars.index), title="No visible sessions")
        print("No visible sessions. Enable a session and at least one display option in Inputs.")
