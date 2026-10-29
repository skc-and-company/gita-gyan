"""Temporary probe: call the eProcurement open-area REST API the way its own page does
and save the raw JSON, so build_tenders.py can be written against real data."""
import json, re, sys, requests

B = "https://eproc2.bihar.gov.in/EPSV2Web"
ca = sys.argv[1]
s = requests.Session()
s.verify = ca
s.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
page = s.get(f"{B}/openarea/tenderListingPage.action", timeout=90).text
tok = re.search(r'id="Authorization"\s+value="([^"]+)"', page) or re.search(r'name="Authorization"[^>]*value="([^"]+)"', page)
org = re.search(r"orgId\s*=\s*'(\d+)'", page)
print("token found:", bool(tok), "orgId:", org and org.group(1))
h = {"Content-Type": "application/json; charset=utf-8", "Accept": "application/json, text/plain, */*",
     "X-Requested-With": "XMLHttpRequest", "Referer": f"{B}/openarea/tenderListingPage.action"}
if tok: h["Authorization"] = tok.group(1)
import time
lst = s.post(B + "/rest/openarea/getTenderList", data="{}", headers=h, timeout=120).json()
ids = [142063, 139951, 139315] + [t["currenttenderid"] for t in lst[:3]] + [t["currenttenderid"] for t in lst[400:402]]
out = {}
for tid in ids:
    r = s.post(f"{B}/rest/quotation/previewTenderByTenderId?tenderId={tid}", headers=h, timeout=60)
    print("preview", tid, r.status_code, len(r.content))
    try: out[tid] = r.json()
    except Exception: out[tid] = r.text[:2000]
    time.sleep(1)
json.dump(out, open("probe/previews.json", "w"), ensure_ascii=False, indent=1)
