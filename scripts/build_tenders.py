"""Build data/tenders.json (Bihar Tenders page) from the Bihar Govt. eProcurement portal.

The portal's public "Latest Tenders" page loads its rows from a JSON API; this script calls
that API the same way the page does (anonymous session token from the page), then reads each
tender's public detail view for its estimated value (PAC), department and procurement category.

    python scripts/build_tenders.py --out data/tenders.json --prev data/tenders.json \
        --ca chain/bundle.pem --cache .cache/tender-details.json

--ca is a CA bundle that includes the portal's intermediate certificate (the server does not
send it); see .github/workflows for how it is assembled. Certificate checks stay on.
"""
import argparse, concurrent.futures as cf, json, os, re, sys, time
from datetime import datetime, timedelta, timezone

import requests

BASE = "https://eproc2.bihar.gov.in/EPSV2Web"
LISTING = f"{BASE}/openarea/tenderListingPage.action"
IST = timezone(timedelta(hours=5, minutes=30))
SERVICE_MIN_CR, OTHER_MIN_CR = 2, 50
KEEP_CLOSED_DAYS = 30
DETAIL_MAX_AGE_DAYS = 7

# A tender counts as "service" when its title describes a service (O&M, agency, consultancy,
# manpower, software, AMC …) or it is IT-related; otherwise works / goods / supply ("other").
SERVICE = re.compile(r"""\b(o\s*&\s*m|operations?\b|maintenance|services?\b|consult\w*|agency|agencies|manpower|hiring
    |outsourc\w*|amc\b|housekeeping|software|system\s+integrator|empanel\w*|management|collection|patrolling
    |testing\s+of|technical\s+support|it\s+solution|insurance|medi-?claim|event)""", re.I | re.X)


def category(title, proc_cat):
    return "service" if SERVICE.search(title or "") or (proc_cat or "").lower().startswith("it-related") else "other"


def ist(ms):
    return datetime.fromtimestamp(ms / 1000, IST).strftime("%Y-%m-%d %H:%M") if ms else ""


def session(ca):
    s = requests.Session()
    s.verify = ca or True
    s.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    page = s.get(LISTING, timeout=90)
    page.raise_for_status()
    tok = re.search(r'id="Authorization"\s+value="([^"]+)"', page.text)
    org = re.search(r"orgId\s*=\s*'(\d+)'", page.text)
    if not tok:
        raise RuntimeError("the listing page no longer carries a session token")
    s.headers.update({"Authorization": tok.group(1), "Accept": "application/json, text/plain, */*",
                      "Content-Type": "application/json; charset=utf-8", "X-Requested-With": "XMLHttpRequest", "Referer": LISTING})
    return s, org.group(1) if org else "538"


def post_json(s, path, body=None, tries=3):
    for i in range(tries):
        try:
            r = s.post(BASE + path, data=json.dumps(body) if body is not None else None, timeout=120)
            r.raise_for_status()
            return r.json()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def fetch_details(s, ids, cache, now_ms):
    """Detail view per tender, cached by portal tender id and refreshed after a week."""
    todo = [i for i in ids if str(i) not in cache or now_ms - cache[str(i)].get("at", 0) > DETAIL_MAX_AGE_DAYS * 86400000]

    def one(tid):
        d = post_json(s, f"/rest/quotation/previewTenderByTenderId?tenderId={tid}")
        m = d.get("tenderPreviewMap") or {}
        hier = (m.get("creatorDetail") or {}).get("OrgHirarchy") or {}
        levels = [hier[k] for k in sorted(hier, key=lambda k: int(k)) if hier[k]]
        return str(tid), {"pac": d.get("pacamt"), "proc_cat": m.get("procCat"), "levels": levels, "at": now_ms}

    failed = 0
    with cf.ThreadPoolExecutor(4) as ex:
        for fut in cf.as_completed([ex.submit(one, t) for t in todo]):
            try:
                k, v = fut.result()
                cache[k] = v
            except Exception:
                failed += 1
    print(f"details: {len(ids) - len(todo)} cached, {len(todo) - failed} fetched, {failed} failed", file=sys.stderr)
    return cache


def build(rows, details, depts, proc_names, prev, now):
    """Pure transform: portal rows + detail views (+ previous file) → tenders.json dict."""
    now_ms = int(now.timestamp() * 1000)
    today = now.astimezone(IST).strftime("%Y-%m-%d")
    first_seen = {t["id"]: t.get("first_seen") for t in (prev or {}).get("tenders", [])}
    out, without_value, listed_ids = [], 0, set()
    for r in rows:
        tid = str(r["currenttenderid"])
        if tid in listed_ids:
            continue
        listed_ids.add(tid)
        det = details.get(tid) or {}
        pac = det.get("pac") or r.get("currentpacamt")
        if not pac:
            without_value += 1
            continue
        value_cr = round(pac / 1e7, 2)
        levels = det.get("levels") or []
        dept_name = depts.get(r.get("currentdeptid"), "")
        department = levels[1] if len(levels) > 1 else dept_name
        office = levels[-1] if levels else dept_name
        proc_cat = det.get("proc_cat") or proc_names.get(r.get("currentproccatid"), "")
        title = (r.get("currentdescription") or "").strip()
        cat = category(title, proc_cat)
        if value_cr < (SERVICE_MIN_CR if cat == "service" else OTHER_MIN_CR):
            continue
        closing_ms = r.get("currentbidEndDate") or 0
        seen = first_seen.get(tid) or today
        out.append({
            "id": tid, "tender_id": r.get("currentOrgTenderId"), "ref_no": (r.get("currenttenderrefno") or "").strip(),
            "title": title, "department": department, "office": office, "proc_cat": proc_cat, "category": cat,
            "value_cr": value_cr, "published": ist(r.get("currentTenderPublishDate")), "closing": ist(closing_ms),
            "closing_ms": closing_ms, "published_ms": r.get("currentTenderPublishDate") or 0, "first_seen": seen,
            "link": LISTING, "search_hint": f"Search Tender ID {r.get('currentOrgTenderId')} on the portal",
            "status": "live" if closing_ms > now_ms else "closed", "new_today": seen == today,
        })
    # Tenders that dropped off the live list after closing stay for a while as "closed".
    carried = 0
    for t in (prev or {}).get("tenders", []):
        if t["id"] in listed_ids or not t.get("closing_ms"):
            continue
        if t["closing_ms"] <= now_ms and now_ms - t["closing_ms"] <= KEEP_CLOSED_DAYS * 86400000:
            out.append({**t, "status": "closed", "new_today": False})
            carried += 1
    out.sort(key=lambda t: t["closing_ms"])
    stamp = now.astimezone(IST)
    live = [t for t in out if t["status"] == "live"]
    return {
        "fetched_at": stamp.strftime("%Y-%m-%d %H:%M IST"), "fetched_at_iso": stamp.isoformat(timespec="seconds"),
        "fetch_status": "ok", "fetch_error": None, "last_successful_fetch": stamp.strftime("%Y-%m-%d %H:%M IST"),
        "source": "Bihar Govt. eProcurement — eproc2.bihar.gov.in (public Latest Tenders listing)", "source_url": LISTING,
        "thresholds": {"service_min_cr": SERVICE_MIN_CR, "other_min_cr": OTHER_MIN_CR},
        "stats": {
            "portal_listed": len(rows), "tracked_total": len(rows) + carried, "live_without_value": without_value,
            "service_live": sum(t["category"] == "service" for t in live), "other_live": sum(t["category"] == "other" for t in live),
            "new_today": sum(t["new_today"] for t in out), "closed": sum(t["status"] == "closed" for t in out),
        },
        "tenders": out,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--prev")
    ap.add_argument("--ca")
    ap.add_argument("--cache")
    a = ap.parse_args()
    now = datetime.now(timezone.utc)
    prev = json.load(open(a.prev, encoding="utf-8")) if a.prev and os.path.exists(a.prev) else None
    cache = json.load(open(a.cache)) if a.cache and os.path.exists(a.cache) else {}

    s, org = session(a.ca)
    rows = post_json(s, "/rest/openarea/getTenderList", {})
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("the portal returned no tenders")
    depts = {d["organizationId"]: d["organizationName"] for d in post_json(s, f"/rest/organization/loadAllDeptWithParent?orgId={org}")}
    masters = post_json(s, "/rest/master/showRfqCategoryRfqTypeProcCatBidPartList")
    proc_names = {p["proccatId"]: p["description"] for p in masters.get("procCatList", [])}
    cache = fetch_details(s, [r["currenttenderid"] for r in rows], cache, int(now.timestamp() * 1000))
    if a.cache:
        os.makedirs(os.path.dirname(a.cache) or ".", exist_ok=True)
        json.dump(cache, open(a.cache, "w"))

    data = build(rows, cache, depts, proc_names, prev, now)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(json.dumps(data["stats"]), file=sys.stderr)


if __name__ == "__main__":
    main()
