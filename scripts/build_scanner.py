#!/usr/bin/env python3
"""Rebuild data/scanner.json for the Capital Market Scanner page (#/scanner).

Universe: the NIFTY 500 constituent list from NSE archives.
Data:     daily prices and fundamentals from Yahoo Finance (yfinance).
Method:   the one shown on the scanner page and stored in the file's "config":
          liquidity + profit filter, the SKC rating (depth, profit-making capacity,
          management integrity, sales growth), and four chart patterns
          (double / triple bottom, >20% below the 200-DMA, breakdown, 52-week low).
          New-age symbols that still make losses are scored separately on depth,
          sales growth and path to profitability.

Usage:    python scripts/build_scanner.py [--out data/scanner.json] [--cache .cache/fundamentals.json]

Fundamentals are cached for config.fundamentals_max_age_days, so a daily run only
re-downloads the stale ones. The "config" block of the existing output file is kept
(so changed weights survive the next run); anything missing falls back to DEFAULT_CONFIG.
The script exits with an error, and leaves the old file alone, if the data looks broken.
"""
import argparse
import io
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import pandas as pd
import requests
import yfinance as yf

IST = timezone(timedelta(hours=5, minutes=30))
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"}
TABS = ["bottom", "below200", "breakdown", "low52"]
SOURCES = ["NSE archives: NIFTY 500 constituent list", "Yahoo Finance via yfinance: daily OHLCV, fundamentals, dividends"]
NA_ISS, NA_PLEDGE = "governance risk (ISS)", "pledge (no free source)"
SWING = 7               # a swing low is the lowest close of the 7 sessions either side
RECENT_TROUGH = 60      # the last trough of a double / triple bottom must be this recent (sessions)
MAX_TROUGH_GAP = 45     # and the troughs at most this many sessions apart
MIN_HISTORY = 200       # sessions needed for the 200-DMA and patterns
MIN_WITH_PRICES = 0.8   # refuse to publish if fewer than 80% of the universe has prices

DEFAULT_CONFIG = {
    "_note": "Owner's rating method: Depth, Profit-making capacity, Management integrity, Sales growth. Weights configurable (normalised). Missing data = n/a, scored neutral 0.5 and listed in 'na'.",
    "universe_url": "https://archives.nseindia.com/content/indices/ind_nifty500list.csv",
    "min_avg_traded_value_cr": 2,
    "fundamentals_max_age_days": 7,
    "weights": {"depth": 25, "profit": 25, "management": 25, "sales_growth": 25},
    "rating_bands": {"A": 70, "B": 50},
    "patterns": {"dbl_lookback_days": 250, "trough_tolerance_pct": 4, "min_peak_rise_pct": 8, "min_trough_gap_days": 15,
                 "below200_ratio": 0.8, "breakdown_windows": [20, 50], "breakdown_recent_days": 5, "near_52w_low_pct": 2},
    "newage_weights": {"depth": 35, "sales_growth": 40, "path_to_profit": 25},
    "newage_symbols": ["ZOMATO", "ETERNAL", "SWIGGY", "PAYTM", "NYKAA", "POLICYBZR", "DELHIVERY", "OLAELEC", "FIRSTCRY", "IXIGO",
                       "MAPMYINDIA", "NAZARA", "CARTRADE", "EASEMYTRIP", "HONASA", "OLECTRA", "URBANCO", "LENSKART", "GROWW", "MEESHO",
                       "AWFIS", "IDEAFORGE", "ZAGGLE", "TBOTEK", "JUSTDIAL", "INDIAMART", "INFOEDGE", "ROUTE", "LATENTVIEW", "RATEGAIN",
                       "DREAMFOLKS", "BLACKBUCK", "ZINKA", "PINELABS", "NSDL", "SAGILITY", "IGIL", "OLA"],
}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def num(v):
    """float(v), or None for missing / NaN / inf."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def rnd(v, d=1):
    return None if v is None else round(v, d)


def lin(x, lo, hi):
    """0 at lo, 1 at hi (either direction), clipped."""
    return min(1.0, max(0.0, (x - lo) / (hi - lo)))


def load_config(path):
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f).get("config") or {}
        for k, v in old.items():
            if k in cfg and isinstance(v, dict) and isinstance(cfg[k], dict):
                cfg[k].update({kk: vv for kk, vv in v.items() if kk in cfg[k]})
            elif k in cfg and type(v) is type(cfg[k]):
                cfg[k] = v
    except (OSError, ValueError, AttributeError):
        pass
    return cfg


# ---------------------------------------------------------------- universe

def load_universe(url, cache_path):
    try:
        r = requests.get(url, headers=UA, timeout=30)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        df = df[df["Series"].astype(str).str.strip() == "EQ"].drop_duplicates("Symbol")
        uni = [{"symbol": s.strip(), "name": n.strip(), "sector": i.strip()} for s, n, i in zip(df["Symbol"], df["Company Name"], df["Industry"])]
        if len(uni) < 400:
            raise ValueError(f"only {len(uni)} symbols")
        return uni
    except Exception as e:
        cached = read_json(cache_path).get("_universe")
        if not cached:
            raise SystemExit(f"Couldn't download the NIFTY 500 list ({e}) and there is no cached copy.")
        log(f"NIFTY 500 list download failed ({e}); using the cached list of {len(cached)}.")
        return cached


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


# ---------------------------------------------------------------- prices

def download_prices(symbols):
    """{symbol: DataFrame[Open High Low Close Volume Dividends]} for the last ~5 years (dividend record needs it).
    Symbols with fewer than 20 sessions (just listed) are left out."""
    out = {}
    for start in range(0, len(symbols), 100):
        batch = symbols[start:start + 100]
        tick = [s + ".NS" for s in batch]
        for attempt in range(3):
            try:
                df = yf.download(tick, period="5y", interval="1d", auto_adjust=True, actions=True, group_by="ticker",
                                 threads=True, progress=False)
                break
            except Exception as e:
                log(f"price download failed ({e}); retrying")
                time.sleep(20 * (attempt + 1))
        else:
            continue
        for s, t in zip(batch, tick):
            if t not in df.columns.get_level_values(0):
                continue
            d = df[t].dropna(subset=["Close"])
            if len(d) >= 20:
                out[s] = d
    return out


# ---------------------------------------------------------------- fundamentals

def rows_of(df, name):
    """A line of a yfinance statement as a list, newest first, None for gaps."""
    if df is None or df.empty or name not in df.index:
        return []
    return [num(v) for v in df.loc[name].tolist()]


def first(vals):
    return next((v for v in vals if v is not None), None)


def fetch_fundamentals(symbol):
    t = yf.Ticker(symbol + ".NS")
    info = t.info or {}
    inc, bs, q = t.income_stmt, t.balance_sheet, t.quarterly_income_stmt
    rev = rows_of(inc, "Total Revenue")
    ni = rows_of(inc, "Net Income")
    ebit = rows_of(inc, "EBIT")
    ta, cl = rows_of(bs, "Total Assets"), rows_of(bs, "Current Liabilities")
    eq = rows_of(bs, "Stockholders Equity")
    qni = rows_of(q, "Net Income")
    return {
        "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "name": info.get("longName") or info.get("shortName"),
        "shares": num(info.get("sharesOutstanding")) or num(info.get("impliedSharesOutstanding")),
        "mcap": num(info.get("marketCap")),
        "eps": num(info.get("trailingEps")),
        "fwd_eps": num(info.get("forwardEps")),
        "roe": num(info.get("returnOnEquity")),
        "de": num(info.get("debtToEquity")),
        "promoter": num(info.get("heldPercentInsiders")),
        "margin": num(info.get("profitMargins")),
        "rev_growth": num(info.get("revenueGrowth")),
        "ttm_ni": num(info.get("netIncomeToCommon")),
        "iss": num(info.get("overallRisk")),
        "cash": num(info.get("totalCash")),
        "fcf": num(info.get("freeCashflow")),
        "ocf": num(info.get("operatingCashflow")),
        "rev": rev, "ni": ni,
        "ebit": first(ebit), "ta": first(ta), "cl": first(cl), "eq": first(eq),
        "qni": qni,
    }


def refresh_fundamentals(symbols, cache, max_age_days):
    now = datetime.now(timezone.utc)
    stale = [s for s in symbols
             if s not in cache or now - datetime.fromisoformat(cache[s].get("fetched", "2000-01-01T00:00:00+00:00")) > timedelta(days=max_age_days)]
    log(f"fundamentals: {len(symbols) - len(stale)} cached, {len(stale)} to fetch")

    def one(s):
        for attempt in range(3):
            try:
                return s, fetch_fundamentals(s)
            except Exception as e:
                msg = str(e)
                time.sleep((30 if "Rate" in msg or "Too Many" in msg else 3) * (attempt + 1))
        return s, None

    failed = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, (s, f) in enumerate(pool.map(one, stale), 1):
            if f:
                cache[s] = f
            else:
                failed += 1
            if i % 50 == 0:
                log(f"  {i}/{len(stale)} fetched")
    if failed:
        log(f"fundamentals: {failed} failed (older cached values kept where there were any)")


# ---------------------------------------------------------------- patterns

def swing_lows(close):
    n = len(close)
    return [i for i in range(SWING, n - SWING) if close[i] == close[i - SWING:i + SWING + 1].min()]


def find_bottom(d, p):
    """The most recent double / triple bottom in the lookback window, on closing prices, or None.

    Troughs are swing-low closes within trough_tolerance_pct of each other, min_trough_gap_days to
    MAX_TROUGH_GAP sessions apart, with a close at least min_peak_rise_pct higher between them and
    no lower close in between. The last trough must be in the last RECENT_TROUGH sessions and the
    latest close at or above the trough (average of the trough closes).
    """
    d = d.iloc[-p["dbl_lookback_days"]:]
    close = d["Close"].to_numpy()
    n, tol, rise, gap = len(d), p["trough_tolerance_pct"] / 100, p["min_peak_rise_pct"] / 100, p["min_trough_gap_days"]
    sl = swing_lows(close)

    def earlier_trough(j):
        for i in reversed([x for x in sl if x < j]):
            if j - i < gap:
                continue
            if j - i > MAX_TROUGH_GAP:
                return None
            if (abs(close[i] / close[j] - 1) <= tol and close[i:j + 1].max() >= max(close[i], close[j]) * (1 + rise)
                    and close[i:j + 1].min() >= min(close[i], close[j]) * 0.999):
                return i
        return None

    for j in reversed(sl):
        if j < n - RECENT_TROUGH:
            return None
        i = earlier_trough(j)
        if i is not None:
            break
    else:
        return None
    troughs = [i, j]
    h = earlier_trough(i)
    if h is not None and abs(close[h] / close[j] - 1) <= tol:
        troughs.insert(0, h)
    trough = sum(close[x] for x in troughs) / len(troughs)
    c = close[-1]
    if c < trough:
        return None
    neck = close[troughs[0]:j + 1].max()
    return {"type": "Triple bottom" if len(troughs) == 3 else "Double bottom", "trough": round(float(trough), 2),
            "neckline": round(float(neck), 2), "to_neck_pct": round((c / neck - 1) * 100, 1),
            "status": "Breakout" if c >= neck else "Recovering",
            "troughs": [d.index[x].strftime("%Y-%m-%d") for x in troughs]}


def find_breakdown(d, p):
    low, close = d["Low"].to_numpy(), d["Close"].to_numpy()
    n = len(d)
    for k in range(n - 1, n - 1 - p["breakdown_recent_days"], -1):
        for w in sorted(p["breakdown_windows"], reverse=True):
            if k - w < 0:
                continue
            support = low[k - w:k].min()
            if close[k] < support:
                return {"date": d.index[k].strftime("%Y-%m-%d"), "window": w, "support": round(float(support), 2),
                        "below_pct": round((close[-1] / support - 1) * 100, 1)}
    return None


# ---------------------------------------------------------------- SKC rating

def pillar(parts, na):
    """parts: [(label, score 0..1 or None)]. Missing scores count 0.5 and are listed in na."""
    vals = []
    for label, v in parts:
        if v is None:
            na.append(label)
            v = 0.5
        vals.append(v)
    return round(100 * sum(vals) / len(vals))


def weighted(pillars, weights):
    tot = sum(weights.values())
    return round(sum(pillars[k] * w for k, w in weights.items()) / tot, 1)


def rating(score, bands):
    return "A" if score >= bands["A"] else "B" if score >= bands["B"] else "C"


def div_years(divs, as_of):
    """Number of the last 5 years (365-day blocks ending today) with at least one dividend."""
    divs = divs[divs > 0]
    if divs.empty:
        return 0
    idx = divs.index.tz_localize(None) if divs.index.tz is not None else divs.index
    ages = (pd.Timestamp(as_of) - idx.normalize()).days
    return len({int(a // 365) for a in ages if 0 <= a < 5 * 365})


def build_row(u, d, f, cfg, newage):
    close = float(d["Close"].iloc[-1])
    as_of = d.index[-1].strftime("%Y-%m-%d")
    p = cfg["patterns"]
    na = []

    shares = f.get("shares")
    mcap = shares * close if shares else f.get("mcap")
    mcap_cr = mcap / 1e7 if mcap else None
    adv_cr = float((d["Close"] * d["Volume"]).iloc[-20:].mean()) / 1e7
    eps, fwd = f.get("eps"), f.get("fwd_eps")
    pe = close / eps if eps and eps > 0 else None
    ni, rev = f.get("ni") or [], f.get("rev") or []
    eq = f.get("eq")
    roe = f["roe"] * 100 if f.get("roe") is not None else (ni[0] / eq * 100 if ni and ni[0] is not None and eq and eq > 0 else None)
    cap_emp = (f["ta"] - f["cl"]) if f.get("ta") and f.get("cl") is not None else None
    roce = f["ebit"] / cap_emp * 100 if f.get("ebit") is not None and cap_emp and cap_emp > 0 else None
    de = f["de"] / 100 if f.get("de") is not None else None
    last_year = d.index[-1] - pd.Timedelta(days=365)
    dps = float(d["Dividends"][d.index > last_year].sum()) if "Dividends" in d else 0.0
    dy = dps / close * 100
    dyears = div_years(d["Dividends"], as_of) if "Dividends" in d else 0
    paid_recently = bool("Dividends" in d and (d["Dividends"][d.index > d.index[-1] - pd.Timedelta(days=400)] > 0).any())
    np_growth = (ni[0] / ni[1] - 1) * 100 if len(ni) > 1 and ni[0] is not None and ni[1] and ni[1] > 0 else None
    revs = [v for v in rev[:4] if v is not None]
    rev_cagr = ((revs[0] / revs[-1]) ** (1 / (len(revs) - 1)) - 1) * 100 if len(revs) >= 2 and revs[-1] > 0 and revs[0] > 0 else None
    margin = f["margin"] * 100 if f.get("margin") is not None else None
    promoter = f["promoter"] * 100 if f.get("promoter") is not None else None
    fwd_growth = (fwd / eps - 1) * 100 if fwd is not None and eps and eps > 0 else None

    # Depth: size and how easily the stock trades.
    depth = pillar([("market cap", lin(math.log10(mcap_cr), 3.3, 5.3) if mcap_cr else None),
                    ("traded value", lin(math.log10(max(adv_cr, 0.01)), 0.3, 2.5))], na)
    # Profit-making capacity: returns, margin and profit growth.
    profit = pillar([("ROE", lin(roe, 0, 22) if roe is not None else None),
                     ("ROCE", lin(roce, 0, 25) if roce is not None else None),
                     ("margin", lin(margin, 0, 15) if margin is not None else None),
                     ("NP growth", lin(np_growth, -20, 30) if np_growth is not None else None)], na)
    # Management integrity: promoter skin in the game, governance, leverage, dividend record.
    prom = None if promoter is None else 0.5 if promoter < 1 else lin(promoter, 10, 55)   # <1%: no promoter group (widely held)
    mgmt = pillar([("promoter holding", prom),
                   (NA_ISS, lin(f["iss"], 10, 1) if f.get("iss") else None),
                   (NA_PLEDGE, None),
                   ("D/E", lin(de, 2, 0.1) if de is not None else None),
                   ("dividend record", dyears / 5)], na)
    # Sales growth: 3-year revenue CAGR, latest revenue growth, analysts' forward EPS growth.
    sales = pillar([("revenue CAGR", lin(rev_cagr, 0, 25) if rev_cagr is not None else None),
                    ("revenue growth", lin(f["rev_growth"] * 100, 0, 25) if f.get("rev_growth") is not None else None),
                    ("forward EPS growth", lin(fwd_growth, 0, 20) if fwd_growth is not None else None)], na)
    pillars = {"depth": depth, "profit": profit, "management": mgmt, "sales_growth": sales}
    if newage:
        # Path to profit: losses narrowing year on year and quarter on quarter, and cash runway.
        narrowing = (lin((ni[0] - ni[1]) / abs(ni[1]), -0.2, 0.5) if len(ni) > 1 and ni[0] is not None and ni[1] else None)
        qni = [v for v in (f.get("qni") or []) if v is not None]
        q_trend = lin((qni[0] - qni[-1]) / abs(qni[-1]), -0.2, 0.5) if len(qni) >= 3 and qni[-1] else None
        burn = -f["fcf"] if f.get("fcf") is not None and f["fcf"] < 0 else 0
        runway = (1.0 if burn == 0 else lin(f["cash"] / burn, 0.5, 3)) if f.get("cash") is not None and f.get("fcf") is not None else None
        pillars["path_to_profit"] = pillar([("loss narrowing", narrowing), ("quarterly trend", q_trend), ("cash runway", runway)], na)
        score = weighted(pillars, cfg["newage_weights"])
    else:
        score = weighted(pillars, cfg["weights"])

    sma200 = float(d["Close"].iloc[-200:].mean())
    low52, high52 = float(d["Low"].iloc[-250:].min()), float(d["High"].iloc[-250:].max())
    vs200 = (close / sma200 - 1) * 100
    from52 = (close / low52 - 1) * 100
    bottom = find_bottom(d, p)
    breakdown = find_breakdown(d, p)
    tabs = [t for t, hit in zip(TABS, [bottom, close < p["below200_ratio"] * sma200, breakdown, from52 <= p["near_52w_low_pct"]]) if hit]
    return {
        "symbol": u["symbol"], "name": f.get("name") or u["name"], "sector": u["sector"], "price": round(close, 2), "date": as_of,
        "mcap_cr": round(mcap_cr) if mcap_cr else None, "pe": rnd(pe), "roe": rnd(roe), "roce": rnd(roce), "de": rnd(de, 2),
        "dy": round(dy, 2), "np_growth": rnd(np_growth), "promoter": rnd(promoter), "dividend_payer": paid_recently,
        "adv_cr": round(adv_cr, 1), "score": score, "rating": rating(score, cfg["rating_bands"]), "pillars": pillars,
        "na": na,
        "newage": newage, "rev_cagr": rnd(rev_cagr), "margin": rnd(margin), "sma200": round(sma200, 2), "vs200_pct": round(vs200, 1),
        "low52": round(low52, 2), "high52": round(high52, 2), "from52low_pct": round(from52, 1),
        "chart": "https://www.tradingview.com/chart/?symbol=" + quote("NSE:" + u["symbol"], safe=":"),
        "bottom": bottom, "breakdown": breakdown, "tabs": tabs,
    }


# ---------------------------------------------------------------- main

def check(out):
    """Same rules as checkScanner() in assets/markets.js."""
    if not isinstance(out.get("rows"), list) or not out.get("counts") or not out.get("config"):
        return "it needs rows, counts and config."
    if not out.get("generated_ist") or not out.get("as_of"):
        return "it is missing generated_ist / as_of."
    bad = next((r for r in out["rows"] if not r.get("symbol") or not isinstance(r.get("tabs"), list) or r.get("score") is None or not r.get("rating")), None)
    return f"row {bad.get('symbol', '?')} is missing symbol, tabs, score or rating." if bad else ""


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--out", default=os.path.join(here, "data", "scanner.json"))
    ap.add_argument("--cache", default=os.path.join(here, ".cache", "fundamentals.json"))
    ap.add_argument("--limit", type=int, default=0, help="only the first N symbols (for a quick test; output is not checked for size)")
    a = ap.parse_args()
    t0 = time.time()

    cfg = load_config(a.out)
    cache = read_json(a.cache)
    universe = load_universe(cfg["universe_url"], a.cache)
    if a.limit:
        universe = universe[:a.limit]
    cache["_universe"] = universe
    syms = [u["symbol"] for u in universe]

    prices = download_prices(syms)
    log(f"prices: {len(prices)}/{len(syms)}")
    if not a.limit and len(prices) < MIN_WITH_PRICES * len(syms):
        raise SystemExit(f"Only {len(prices)} of {len(syms)} symbols have prices; not publishing.")
    as_of = pd.Series([d.index[-1] for d in prices.values()]).mode()[0]
    prices = {s: d for s, d in prices.items() if d.index[-1] >= as_of - pd.Timedelta(days=7)}   # drop suspended / stale

    min_adv = cfg["min_avg_traded_value_cr"]
    liquid = [s for s, d in prices.items() if float((d["Close"] * d["Volume"]).iloc[-20:].mean()) / 1e7 >= min_adv]
    refresh_fundamentals(liquid, cache, cfg["fundamentals_max_age_days"])
    os.makedirs(os.path.dirname(os.path.abspath(a.cache)), exist_ok=True)
    with open(a.cache, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, separators=(",", ":"))

    newage_set = set(cfg["newage_symbols"])
    by_sym = {u["symbol"]: u for u in universe}
    rows, profitable, newage_loss = [], 0, 0
    for s in liquid:
        f = cache.get(s)
        if not f:
            continue
        ni = f.get("ni") or []
        latest_ni, ttm = (ni[0] if ni else None), f.get("ttm_ni")
        is_profit = latest_ni is not None and latest_ni > 0 and (ttm is None or ttm > 0)
        if is_profit:
            profitable += 1
        elif s in newage_set:
            newage_loss += 1
        else:
            continue
        if len(prices[s]) < MIN_HISTORY:
            continue
        try:
            r = build_row(by_sym[s], prices[s], f, cfg, newage=not is_profit)
        except Exception as e:
            log(f"{s}: skipped ({e})")
            continue
        if r["tabs"]:
            rows.append(r)

    rows.sort(key=lambda r: -r["score"])
    out = {
        "counts_newage": {t: sum(t in r["tabs"] for r in rows if r["newage"]) for t in TABS},
        "generated_ist": datetime.now(IST).strftime("%Y-%m-%d %H:%M IST"),
        "as_of": as_of.strftime("%Y-%m-%d"),
        "stats": {"universe": len(universe), "with_prices": len(prices), "liquid": len(liquid), "profitable": profitable,
                  "newage_lossmaking": newage_loss},
        "counts": {t: sum(t in r["tabs"] for r in rows if not r["newage"]) for t in TABS},
        "config": cfg,
        "runtime_s": round(time.time() - t0),
        "sources": SOURCES,
        "rows": rows,
    }
    problem = check(out)
    if problem:
        raise SystemExit(f"Output failed the page's check: {problem}")
    if not a.limit and profitable < 0.5 * len(liquid):
        raise SystemExit(f"Only {profitable} of {len(liquid)} liquid stocks look profit-making; fundamentals probably failed. Not publishing.")
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, a.out)
    log(f"wrote {a.out}: {len(rows)} rows, counts {out['counts']}, new-age {out['counts_newage']}, {out['runtime_s']} s")


if __name__ == "__main__":
    main()
