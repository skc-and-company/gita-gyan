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
calls = {
    "tenders": ("/rest/openarea/getTenderList", {}),
    "depts": (f"/rest/organization/loadAllDeptWithParent?orgId={org.group(1) if org else 0}", None),
    "masters": ("/rest/master/showRfqCategoryRfqTypeProcCatBidPartList", None),
    "combo": ("/rest/master/getMasterListForOpenareaTenderListing", None),
}
for name, (path, body) in calls.items():
    r = s.post(B + path, data=json.dumps(body) if body is not None else None, headers=h, timeout=120)
    print(name, r.status_code, len(r.content), r.headers.get("content-type"), r.headers.get("errorMsg"))
    open(f"probe/{name}.json", "wb").write(r.content)
