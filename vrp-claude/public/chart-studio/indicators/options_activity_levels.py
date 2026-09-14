"""Editable chain-activity levels; no invented sweeps, blocks or buy/sell classifications."""
def calculate(ctx):
    meta = ctx.greeks.meta
    snap = ctx.greeks.snapshot()
    chain = ctx.greeks.chain()
    min_volume = ctx.input.int("min_volume", 100, 0, 10000000)
    min_ratio = ctx.input.float("min_volume_oi", 1.5, 0, 100, .1)
    max_dte = ctx.input.int("max_dte", 30, 0, 730)
    top_n = ctx.input.int("top_levels", 5, 1, 15)
    min_proxy = ctx.input.float("min_premium_proxy", 0, 0, 1e10, 1000)
    if ctx.symbol.split(":")[-1].upper() != meta["ticker"].upper():
        raise ValueError("Activity strike levels require a matching chart underlying. Use the source Yahoo chart.")
    data = chain[(chain.dte <= max_dte) & (chain.volume >= min_volume)].copy()
    data["ratio"] = data.volume / data.oi.where(data.oi > 0)
    data["proxy"] = data.volume * data.mid_price * float(meta["contract_size"])
    data = data[(data.ratio >= min_ratio) & (data.proxy >= min_proxy)].sort_values("proxy", ascending=False).head(top_n)
    if data.empty:
        raise ValueError("No activity matches filters; lower min_volume, min_volume_oi or min_premium_proxy")
    for index, (_, row) in enumerate(data.iterrows()):
        ctx.plot.hline(f"activity_{index}", row.strike, color="#45c9b0" if row.option_type == "call" else "#df7884",
                       title=f"NOW {row.option_type} {row.expiry} · Vol/OI {row.ratio:.1f}")
        print(f"{row.expiry} {row.option_type} {row.strike:g}: volume {row.volume:g}, OI {row.oi:g}, IV {row.iv:.2%}, premium proxy {row.proxy:,.0f}")
    print(f"As of {snap['timestamp']}; chain activity only. Colors identify call/put, not buyer direction. Unknown/zero OI is excluded from ratios.")
