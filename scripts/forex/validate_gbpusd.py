#!/usr/bin/env python3
import csv, hashlib, json, math, sys
from datetime import datetime, timezone
from pathlib import Path

OUT=Path("reports"); OUT.mkdir(parents=True, exist_ok=True)
PIP=0.0001; PERIOD=14
SPECS=[("h1","bid",3600),("h1","ask",3600),("h4","bid",14400),("h4","ask",14400)]

def digest(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1048576),b""): h.update(b)
 return h.hexdigest()

def read_csv(p, tf):
 step=3600 if tf=="h1" else 14400
 rows=[]; errors=[]; seen=set(); duplicates=0; gaps=[]
 with p.open(newline="",encoding="utf-8-sig") as f:
  rd=csv.DictReader(f)
  need={"timestamp","open","high","low","close"}
  if not rd.fieldnames or not need.issubset(rd.fieldnames): raise ValueError("Missing expected CSV columns: "+str(rd.fieldnames))
  for line,r in enumerate(rd,2):
   try:
    ts=int(float(r["timestamp"]))//1000
    o,h,l,c=[float(r[k]) for k in ("open","high","low","close")]
    if not all(math.isfinite(x) and x>0 for x in (o,h,l,c)): raise ValueError("invalid numeric OHLC")
    if h<max(o,c,l) or l>min(o,c,h): raise ValueError("invalid OHLC relationship")
    if ts in seen: duplicates+=1; continue
    seen.add(ts); rows.append({"timestamp":ts,"open":o,"high":h,"low":l,"close":c})
   except Exception as e: errors.append({"line":line,"error":str(e)})
 rows.sort(key=lambda x:x["timestamp"])
 for a,b in zip(rows,rows[1:]):
  d=b["timestamp"]-a["timestamp"]
  if d!=step:
   gaps.append({"from_utc":datetime.fromtimestamp(a["timestamp"],timezone.utc).isoformat(),
    "to_utc":datetime.fromtimestamp(b["timestamp"],timezone.utc).isoformat(),
    "elapsed_seconds":d,"missing_intervals":max(0,d//step-1),
    "classification":"market-closure-or-missing-data-review"})
 return rows,errors,duplicates,gaps

def trs(rows):
 return [max(r["high"]-r["low"],abs(r["high"]-p["close"]),abs(r["low"]-p["close"]))
  for p,r in zip(rows,rows[1:])]

def atr_recursive(rows,n=PERIOD):
 t=trs(rows)
 if len(t)<n:return None
 a=sum(t[:n])/n
 for x in t[n:]:a=((n-1)*a+x)/n
 return a

def atr_weighted(rows,n=PERIOD):
 t=trs(rows)
 if len(t)<n:return None
 seed=sum(t[:n])/n; tail=t[n:]; decay=(n-1)/n
 return seed*decay**len(tail)+sum((1/n)*decay**(len(tail)-1-i)*x for i,x in enumerate(tail))

def main():
 now=int(datetime.now(timezone.utc).timestamp())
 report={"schema_version":"1.0","instrument":"GBPUSD","provider":"Dukascopy public historical feed via dukascopy-node 1.51.1",
 "retrieved_at_utc":datetime.now(timezone.utc).isoformat(),"timestamp_convention":"Unix epoch milliseconds; UTC candle start",
 "price_types":["bid","ask"],"timeframes":["H1","H4"],"atr_method":"Wilder smoothing, arithmetic mean seed of first 14 true ranges",
 "pip_size":PIP,"files":[],"status":"PASS"}
 failed=False
 for tf,side,step in SPECS:
  p=Path("data")/f"gbpusd-{tf}-{side}.csv"
  if not p.exists() or p.stat().st_size==0:
   report["files"].append({"file":str(p),"status":"FAIL","error":"missing or empty file"});failed=True;continue
  try:
   rows,errors,dups,gaps=read_csv(p,tf)
   done=[r for r in rows if r["timestamp"]+step<=now]
   a=atr_recursive(done); b=atr_weighted(done)
   match=a is not None and b is not None and abs(a-b)<=1e-12
   ok=bool(rows) and not errors and dups==0 and match
   item={"file":str(p),"status":"PASS" if ok else "FAIL","bytes":p.stat().st_size,"sha256":digest(p),
    "row_count":len(rows),"invalid_rows":len(errors),"duplicate_timestamps":dups,"gap_count":len(gaps),"gap_examples":gaps[:20],
    "start_utc":datetime.fromtimestamp(rows[0]["timestamp"],timezone.utc).isoformat() if rows else None,
    "end_utc":datetime.fromtimestamp(rows[-1]["timestamp"],timezone.utc).isoformat() if rows else None,
    "completed_candle_count":len(done),"last_candle_status":"completed" if rows and rows[-1]["timestamp"]+step<=now else "forming-or-not-yet-closed",
    "last_completed_candle_start_utc":datetime.fromtimestamp(done[-1]["timestamp"],timezone.utc).isoformat() if done else None,
    "timeframe":tf.upper(),"price_type":side,"atr14_price_units":a,"atr14_pips":a/PIP if a is not None else None,
    "atr14_independent_check":"PASS" if match else "FAIL","validation_errors_sample":errors[:20]}
   report["files"].append(item)
   if not ok:failed=True
  except Exception as e:
   report["files"].append({"file":str(p),"status":"FAIL","error":str(e)});failed=True
 report["status"]="FAIL" if failed or len(report["files"])!=4 else "PASS"
 report["note"]="All time values are UTC. Gaps are reported, not automatically called missing because weekends/holidays exist. ATR uses completed candles only. This feed is not the user's MT5 broker feed."
 (OUT/"gbpusd-validation-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
 print(json.dumps(report,indent=2))
 if report["status"]!="PASS":sys.exit(1)
if __name__=="__main__":main()
