#!/usr/bin/env python3
"""Validate GBPUSD candles, normalize epoch units, hash all datasets and report Wilder ATR."""
import csv, gzip, hashlib, json, math, sys
from datetime import datetime, timezone
from pathlib import Path

OUT=Path("reports"); OUT.mkdir(parents=True,exist_ok=True)
PIP=0.0001; N=14
SPECS=[("h1","bid",3600),("h1","ask",3600),("h4","bid",14400),("h4","ask",14400)]
MIN_TS=int(datetime(2000,1,1,tzinfo=timezone.utc).timestamp())
MAX_TS=int(datetime.now(timezone.utc).timestamp())+86400

def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""): h.update(block)
    return h.hexdigest()

def parse_epoch(value):
    """Accept seconds (10 digits), milliseconds (13), microseconds (16), or ns (19)."""
    raw=float(value)
    if not math.isfinite(raw): raise ValueError("non-finite timestamp")
    magnitude=abs(raw)
    if magnitude >= 1e17: unit="ns"; seconds=raw/1e9
    elif magnitude >= 1e14: unit="us"; seconds=raw/1e6
    elif magnitude >= 1e11: unit="ms"; seconds=raw/1e3
    else: unit="s"; seconds=raw
    ts=int(seconds)
    if ts < MIN_TS or ts > MAX_TS:
        raise ValueError(f"timestamp outside accepted GBPUSD coverage window ({unit}): {value}")
    return ts,unit

def read(path,step):
    rows=[]; errors=[]; seen=set(); duplicates=0; gaps=[]; units=set()
    with path.open(newline="",encoding="utf-8-sig") as f:
        reader=csv.DictReader(f); required={"timestamp","open","high","low","close"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("Missing columns: "+str(reader.fieldnames))
        for line,row in enumerate(reader,2):
            try:
                ts,unit=parse_epoch(row["timestamp"]); units.add(unit)
                o,h,l,c=[float(row[k]) for k in ("open","high","low","close")]
                if not all(math.isfinite(v) and v>0 for v in (o,h,l,c)): raise ValueError("invalid numeric OHLC")
                if h<max(o,c,l) or l>min(o,c,h): raise ValueError("invalid OHLC relationship")
                if ts in seen: duplicates+=1; continue
                seen.add(ts); rows.append({"timestamp":ts,"open":o,"high":h,"low":l,"close":c})
            except Exception as exc: errors.append({"line":line,"error":str(exc)})
    rows.sort(key=lambda x:x["timestamp"])
    for a,b in zip(rows,rows[1:]):
        delta=b["timestamp"]-a["timestamp"]
        if delta!=step:
            weekend=(datetime.fromtimestamp(a["timestamp"],timezone.utc).weekday()==4 and datetime.fromtimestamp(b["timestamp"],timezone.utc).weekday() in (0,1)) or delta>=48*3600
            gaps.append({"from_utc":datetime.fromtimestamp(a["timestamp"],timezone.utc).isoformat(),
                "to_utc":datetime.fromtimestamp(b["timestamp"],timezone.utc).isoformat(),
                "elapsed_seconds":delta,"missing_intervals":max(0,delta//step-1),
                "classification":"weekend-or-long-market-closure-review" if weekend else "unexplained-session-gap-review"})
    return rows,errors,duplicates,gaps,sorted(units)

def true_ranges(rows):
    return [max(r["high"]-r["low"],abs(r["high"]-p["close"]),abs(r["low"]-p["close"])) for p,r in zip(rows,rows[1:])]

def atr_recursive(rows):
    values=true_ranges(rows)
    if len(values)<N:return None
    value=sum(values[:N])/N
    for x in values[N:]: value=((N-1)*value+x)/N
    return value

def atr_weighted(rows):
    values=true_ranges(rows)
    if len(values)<N:return None
    seed=sum(values[:N])/N; tail=values[N:]; q=(N-1)/N
    return seed*q**len(tail)+sum((1/N)*q**(len(tail)-1-i)*x for i,x in enumerate(tail))

def main():
    now=int(datetime.now(timezone.utc).timestamp())
    metadata_path=OUT/"source-metadata.json"
    metadata=json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
    report={"schema_version":"1.2","instrument":"GBPUSD","retrieved_at_utc":datetime.now(timezone.utc).isoformat(),
        "source_metadata":metadata,"files":[],"status":"PASS",
        "atr_method":"Wilder ATR(14); arithmetic mean seed of first 14 true ranges; recursive calculation cross-checked against algebraically weighted form",
        "pip_size":PIP}
    failed=False; bid_timeframes=set(); manifest=[]
    for timeframe,side,step in SPECS:
        path=Path("data")/f"gbpusd-{timeframe}-{side}.csv"
        if not path.exists():
            report["files"].append({"file":str(path),"status":"NOT_AVAILABLE","reason":"Provider did not supply this price-side/timeframe; no synthetic data substituted"})
            if side=="bid": failed=True
            continue
        rows,errors,duplicates,gaps,units=read(path,step)
        completed=[r for r in rows if r["timestamp"]+step<=now]
        recursive=atr_recursive(completed); weighted=atr_weighted(completed)
        atr_match=recursive is not None and weighted is not None and abs(recursive-weighted)<=1e-12
        # Source coverage must be plausible and not merely a sequence of epoch-zero values.
        expected_start=metadata.get("derived_outputs",[])
        valid=bool(rows) and not errors and duplicates==0 and atr_match and len(units)==1
        item={"file":str(path),"status":"PASS" if valid else "FAIL","bytes":path.stat().st_size,
            "sha256":digest(path),"row_count":len(rows),"invalid_rows":len(errors),"duplicate_timestamps":duplicates,
            "timestamp_units_in_source":units,"normalized_timestamp_unit":"seconds",
            "gap_count":len(gaps),"gap_classification_counts":{
                "weekend_or_long_market_closure_review":sum(g["classification"]=="weekend-or-long-market-closure-review" for g in gaps),
                "unexplained_session_gap_review":sum(g["classification"]=="unexplained-session-gap-review" for g in gaps)},
            "gap_examples":gaps[:20],
            "start_utc":datetime.fromtimestamp(rows[0]["timestamp"],timezone.utc).isoformat() if rows else None,
            "end_utc":datetime.fromtimestamp(rows[-1]["timestamp"],timezone.utc).isoformat() if rows else None,
            "completed_candle_count":len(completed),"last_candle_status":"completed" if rows and rows[-1]["timestamp"]+step<=now else "forming-or-not-yet-closed",
            "last_completed_candle_start_utc":datetime.fromtimestamp(completed[-1]["timestamp"],timezone.utc).isoformat() if completed else None,
            "timeframe":timeframe.upper(),"price_type":side,"atr14_price_units":recursive,
            "atr14_pips":recursive/PIP if recursive is not None else None,
            "atr14_independent_check":"PASS" if atr_match else "FAIL","validation_errors_sample":errors[:20]}
        report["files"].append(item)
        if side=="bid" and valid: bid_timeframes.add(timeframe)
        if not valid: failed=True
        manifest.append({"path":str(path),"bytes":path.stat().st_size,"sha256":digest(path),"row_count":len(rows),
            "timeframe":timeframe.upper(),"price_type":side,"timestamp_units":units,
            "first_utc":item["start_utc"],"last_utc":item["end_utc"],"validation_status":item["status"]})
    # Hash raw source and all generated report/data files, including the compressed original M1.
    raw=Path("data/raw/histdata-gbpusd-m1-est.csv.gz")
    if raw.exists():
        with gzip.open(raw,"rt",encoding="utf-8",newline="") as f:
            header=f.readline().strip()
            first=f.readline().strip()
        manifest.append({"path":str(raw),"bytes":raw.stat().st_size,"sha256":digest(raw),
            "format":"gzip CSV","header":header,"first_record":first,"source_timezone":metadata.get("source_timezone")})
    else:
        failed=True; report["raw_source_status"]="MISSING"
    if bid_timeframes!={"h1","h4"}: failed=True
    report["required_bid_timeframes_passed"]=sorted(bid_timeframes)
    report["status"]="FAIL" if failed else "PASS"
    report["note"]="HistData M1 OHLC is bid-only. Ask series are not synthesized. Gaps are classified for review, not silently treated as complete. Only completed candles enter ATR. Epoch seconds/milliseconds/microseconds/nanoseconds are normalized explicitly and checked against a plausible date window."
    (OUT/"gbpusd-validation-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    (OUT/"sha256-manifest.json").write_text(json.dumps({"instrument":"GBPUSD","created_at_utc":datetime.now(timezone.utc).isoformat(),"files":manifest},indent=2),encoding="utf-8")
    print(json.dumps(report,indent=2))
    if failed: sys.exit(1)

if __name__=="__main__": main()
