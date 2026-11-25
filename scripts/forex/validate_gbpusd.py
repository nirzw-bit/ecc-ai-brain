#!/usr/bin/env python3
import csv,hashlib,json,math,sys
from datetime import datetime,timezone
from pathlib import Path
OUT=Path("reports");OUT.mkdir(parents=True,exist_ok=True)
PIP=0.0001;N=14;SPECS=[("h1","bid",3600),("h1","ask",3600),("h4","bid",14400),("h4","ask",14400)]

def digest(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1048576),b""):h.update(b)
 return h.hexdigest()
def read(p,step):
 rows=[];errors=[];seen=set();dups=0;gaps=[]
 with p.open(newline="",encoding="utf-8-sig") as f:
  rd=csv.DictReader(f);need={"timestamp","open","high","low","close"}
  if not rd.fieldnames or not need.issubset(rd.fieldnames):raise ValueError("Missing columns: "+str(rd.fieldnames))
  for line,r in enumerate(rd,2):
   try:
    ts=int(float(r["timestamp"]))//1000;o,h,l,c=[float(r[k]) for k in ("open","high","low","close")]
    if not all(math.isfinite(v) and v>0 for v in (o,h,l,c)):raise ValueError("invalid numeric OHLC")
    if h<max(o,c,l) or l>min(o,c,h):raise ValueError("invalid OHLC relationship")
    if ts in seen:dups+=1;continue
    seen.add(ts);rows.append({"timestamp":ts,"open":o,"high":h,"low":l,"close":c})
   except Exception as e:errors.append({"line":line,"error":str(e)})
 rows.sort(key=lambda x:x["timestamp"])
 for a,b in zip(rows,rows[1:]):
  d=b["timestamp"]-a["timestamp"]
  if d!=step:gaps.append({"from_utc":datetime.fromtimestamp(a["timestamp"],timezone.utc).isoformat(),"to_utc":datetime.fromtimestamp(b["timestamp"],timezone.utc).isoformat(),"elapsed_seconds":d,"missing_intervals":max(0,d//step-1),"classification":"market-closure-or-missing-data-review"})
 return rows,errors,dups,gaps
def trs(rows):
 return [max(r["high"]-r["low"],abs(r["high"]-p["close"]),abs(r["low"]-p["close"])) for p,r in zip(rows,rows[1:])]
def atr_recursive(rows):
 t=trs(rows)
 if len(t)<N:return None
 a=sum(t[:N])/N
 for x in t[N:]:a=((N-1)*a+x)/N
 return a
def atr_weighted(rows):
 t=trs(rows)
 if len(t)<N:return None
 seed=sum(t[:N])/N;tail=t[N:];q=(N-1)/N
 return seed*q**len(tail)+sum((1/N)*q**(len(tail)-1-i)*x for i,x in enumerate(tail))
def main():
 now=int(datetime.now(timezone.utc).timestamp());meta={}
 mp=OUT/"source-metadata.json"
 if mp.exists():meta=json.loads(mp.read_text())
 report={"schema_version":"1.1","instrument":"GBPUSD","retrieved_at_utc":datetime.now(timezone.utc).isoformat(),"source_metadata":meta,"files":[],"status":"PASS","atr_method":"Wilder smoothing with arithmetic-mean seed of first 14 true ranges; recursive result independently checked against weighted form","pip_size":PIP}
 failed=False;bid_tf=set()
 for tf,side,step in SPECS:
  p=Path("data")/f"gbpusd-{tf}-{side}.csv"
  if not p.exists():
   report["files"].append({"file":str(p),"status":"NOT_AVAILABLE","reason":"Provider did not supply this price-side/timeframe; no synthetic data substituted"})
   if side=="bid":failed=True
   continue
  rows,errors,dups,gaps=read(p,step);completed=[r for r in rows if r["timestamp"]+step<=now]
  a=atr_recursive(completed);b=atr_weighted(completed);match=a is not None and b is not None and abs(a-b)<=1e-12
  ok=bool(rows) and not errors and dups==0 and match
  item={"file":str(p),"status":"PASS" if ok else "FAIL","bytes":p.stat().st_size,"sha256":digest(p),"row_count":len(rows),"invalid_rows":len(errors),"duplicate_timestamps":dups,"gap_count":len(gaps),"gap_examples":gaps[:20],"start_utc":datetime.fromtimestamp(rows[0]["timestamp"],timezone.utc).isoformat() if rows else None,"end_utc":datetime.fromtimestamp(rows[-1]["timestamp"],timezone.utc).isoformat() if rows else None,"completed_candle_count":len(completed),"last_candle_status":"completed" if rows and rows[-1]["timestamp"]+step<=now else "forming-or-not-yet-closed","last_completed_candle_start_utc":datetime.fromtimestamp(completed[-1]["timestamp"],timezone.utc).isoformat() if completed else None,"timeframe":tf.upper(),"price_type":side,"atr14_price_units":a,"atr14_pips":a/PIP if a is not None else None,"atr14_independent_check":"PASS" if match else "FAIL","validation_errors_sample":errors[:20]}
  report["files"].append(item)
  if side=="bid" and ok:bid_tf.add(tf)
  if not ok:failed=True
 report["required_bid_timeframes_passed"]=sorted(bid_tf)
 if bid_tf!={"h1","h4"}:failed=True
 report["status"]="FAIL" if failed else "PASS"
 report["note"]="Gaps are reported for review; weekend/holiday closures are not automatically labelled missing. Only completed candles enter ATR. HistData M1 OHLC is bid-only; absent ask series are explicitly marked NOT_AVAILABLE."
 (OUT/"gbpusd-validation-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
 print(json.dumps(report,indent=2))
 if failed:sys.exit(1)
if __name__=="__main__":main()
