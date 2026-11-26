#!/usr/bin/env python3
"""Strict freshness and independent streaming M1 -> UTC H1/H4 reconciliation."""
import csv,gzip,hashlib,json,math,sys
from collections import defaultdict
from datetime import datetime,timezone,timedelta
from pathlib import Path

ROOT=Path("."); REPORT=ROOT/"reports/gbpusd-validation-report.json"
RAW=ROOT/"data/raw/histdata-gbpusd-m1-est.csv.gz"
TOLERANCE=0.000005; CLOCK_SKEW_SECONDS=300
OPEN_MAX_AGE=36*3600; WEEKEND_MAX_AGE=72*3600; DECLARED_CLOSURE_MAX_AGE=120*3600
EST=timezone(timedelta(hours=-5))

def parse_utc(value):
    if not value: raise ValueError("missing UTC timestamp")
    dt=datetime.fromisoformat(value.replace("Z","+00:00"))
    if dt.tzinfo is None: raise ValueError("timestamp must include timezone")
    return dt.astimezone(timezone.utc)

def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""): h.update(block)
    return h.hexdigest()

def age_limit(end,closures):
    for c in closures or []:
        try:
            start=parse_utc(c["start_utc"]); finish=parse_utc(c["end_utc"])
            if finish<start: raise ValueError("closure end precedes start")
            if start<=end<=finish: return DECLARED_CLOSURE_MAX_AGE
        except Exception as exc: raise ValueError("invalid scheduled market closure metadata") from exc
    return WEEKEND_MAX_AGE if end.weekday()>=5 else OPEN_MAX_AGE

def freshness(acquisition_start,acquisition_end,requested_end,latest,step,closures=None):
    errors=[]
    try:
        start=parse_utc(acquisition_start); end=parse_utc(acquisition_end)
        req=parse_utc(requested_end); last=parse_utc(latest)
        if start>end: errors.append("acquisition start occurs after completion")
        if (end-start).total_seconds()>6*3600: errors.append("acquisition duration exceeds 6-hour safety bound")
        candle_end=last+timedelta(seconds=step)
        if (candle_end-end).total_seconds()>CLOCK_SKEW_SECONDS: errors.append("latest completed candle is in the future beyond clock-skew tolerance")
        age=max(0,(end-candle_end).total_seconds()); limit=age_limit(end,closures)
        if age>limit: errors.append(f"stale completed candle: age {age:.0f}s exceeds {limit}s policy")
        if req.date()>end.date(): errors.append("acquisition completion precedes requested coverage end date")
        if last.date()<req.date()-timedelta(days=1): errors.append("latest candle coverage ends substantially before requested acquisition period")
        return {"status":"PASS" if not errors else "FAIL","age_seconds":age,"age_hours":round(age/3600,3),
          "max_age_seconds":limit,"latest_completed_candle_start_utc":last.isoformat(),
          "latest_completed_candle_end_utc":candle_end.isoformat(),"requested_end_utc":req.isoformat(),
          "acquisition_start_utc":start.isoformat(),"acquisition_completion_utc":end.isoformat(),"errors":errors}
    except Exception as exc:
        errors.append(str(exc)); return {"status":"FAIL","errors":errors}

def reconstruct():
    """Stream the provider file; memory scales with candle count, not 8.9m M1 rows."""
    if not RAW.exists(): raise ValueError("raw M1 gzip file missing")
    buckets={3600:{},14400:{}}; raw_count=duplicates=out_of_order=0
    previous=None; min_ts=max_ts=None; seen=set()
    with gzip.open(RAW,"rt",encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f); required={"datetime","open","high","low","close"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames): raise ValueError(f"raw M1 CSV schema invalid: {reader.fieldnames}")
        for line,row in enumerate(reader,2):
            dt=datetime.strptime(row["datetime"],"%Y-%m-%d %H:%M:%S").replace(tzinfo=EST).astimezone(timezone.utc)
            ts=int(dt.timestamp())
            if ts in seen: duplicates+=1
            if previous is not None and ts<previous: out_of_order+=1
            seen.add(ts); previous=ts
            v={k:float(row[k]) for k in ("open","high","low","close")}
            if not all(math.isfinite(x) and x>0 for x in v.values()) or v["high"]<max(v.values()) or v["low"]>min(v.values()):
                raise ValueError(f"invalid raw M1 OHLC at line {line}")
            min_ts=ts if min_ts is None else min(min_ts,ts); max_ts=ts if max_ts is None else max(max_ts,ts)
            for step in (3600,14400):
                bucket=(ts//step)*step; group=buckets[step]
                if bucket not in group: group[bucket]={"open":v["open"],"high":v["high"],"low":v["low"],"close":v["close"],"source_m1_count":1}
                else:
                    a=group[bucket]; a["high"]=max(a["high"],v["high"]); a["low"]=min(a["low"],v["low"])
                    a["close"]=v["close"]; a["source_m1_count"]+=1
            raw_count+=1
    if not raw_count: raise ValueError("raw M1 dataset is empty")
    if duplicates: raise ValueError(f"raw M1 contains {duplicates} duplicate timestamps")
    if out_of_order: raise ValueError(f"raw M1 contains {out_of_order} out-of-order records")
    return buckets,{"row_count":raw_count,"first_m1_utc":datetime.fromtimestamp(min_ts,timezone.utc).isoformat(),
      "last_m1_utc":datetime.fromtimestamp(max_ts,timezone.utc).isoformat(),"duplicate_timestamps":duplicates,
      "out_of_order_records":out_of_order,"source_timezone":"fixed EST UTC-5"}

def reconcile(step,buckets,as_of):
    tf="h1" if step==3600 else "h4"; published=ROOT/f"data/gbpusd-{tf}-bid.csv"
    if not published.exists(): return {"status":"FAIL","error":f"published {tf} bid file missing"}
    expected={ts:v for ts,v in buckets[step].items() if ts+step<=as_of}
    actual={}; duplicates=0
    with published.open(newline="",encoding="utf-8-sig") as f:
        r=csv.DictReader(f); required={"timestamp","open","high","low","close","source_m1_count"}
        if not r.fieldnames or not required.issubset(r.fieldnames): return {"status":"FAIL","error":f"published {tf} CSV schema invalid"}
        for row in r:
            ts=int(float(row["timestamp"])/1000)
            if ts in actual: duplicates+=1; continue
            actual[ts]={**{k:float(row[k]) for k in ("open","high","low","close")},"source_m1_count":int(row["source_m1_count"])}
    missing=sorted(set(expected)-set(actual)); extra=sorted(set(actual)-set(expected)); mismatches=[]
    for ts in sorted(set(expected)&set(actual)):
        a=actual[ts]; e=expected[ts]
        bad={k:{"expected":e[k],"actual":a[k]} for k in ("open","high","low","close") if abs(e[k]-a[k])>TOLERANCE}
        if e["source_m1_count"]!=a["source_m1_count"]: bad["source_m1_count"]={"expected":e["source_m1_count"],"actual":a["source_m1_count"]}
        if bad: mismatches.append({"timestamp_utc":datetime.fromtimestamp(ts,timezone.utc).isoformat(),"fields":bad})
    errors=[]
    if duplicates: errors.append(f"{duplicates} duplicate published candle timestamps")
    if missing: errors.append(f"{len(missing)} reconstructed candles missing from published file")
    if extra: errors.append(f"{len(extra)} published candles have no raw M1 source records")
    if mismatches: errors.append(f"{len(mismatches)} candles differ from independent reconstruction")
    return {"timeframe":tf.upper(),"status":"PASS" if not errors else "FAIL","raw_reconstructed_candles":len(expected),
      "published_candles":len(actual),"missing_candles":len(missing),"extra_candles":len(extra),
      "duplicate_published_timestamps":duplicates,"mismatched_candles":len(mismatches),"price_tolerance":TOLERANCE,
      "missing_examples":[datetime.fromtimestamp(x,timezone.utc).isoformat() for x in missing[:10]],
      "extra_examples":[datetime.fromtimestamp(x,timezone.utc).isoformat() for x in extra[:10]],
      "mismatch_examples":mismatches[:10],"errors":errors}

def verify_manifest():
    path=ROOT/"reports/sha256-manifest.json"
    if not path.exists(): return {"status":"FAIL","errors":["SHA-256 manifest missing"]}
    manifest=json.loads(path.read_text()); by_path={x.get("path"):x.get("sha256") for x in manifest.get("files",[])}
    required=["data/raw/histdata-gbpusd-m1-est.csv.gz","data/gbpusd-h1-bid.csv","data/gbpusd-h4-bid.csv"]
    errors=[]; verified={}
    for name in required:
        p=ROOT/name
        if not p.exists(): errors.append(f"required source/output missing: {name}"); continue
        actual=sha256(p); expected=by_path.get(name); verified[name]={"sha256":actual,"manifest_sha256":expected}
        if not expected or actual!=expected: errors.append(f"SHA-256 mismatch or missing manifest entry: {name}")
    return {"status":"PASS" if not errors else "FAIL","files":verified,"errors":errors}

def main():
    meta_path=ROOT/"reports/source-metadata.json"
    if not meta_path.exists(): raise ValueError("source provenance metadata missing")
    metadata=json.loads(meta_path.read_text()); source_errors=[]
    if metadata.get("provider")!="HistData.com": source_errors.append("selected provider is not recorded as HistData.com")
    if metadata.get("source_timezone")!="EST fixed UTC-5 without DST": source_errors.append("source timezone metadata is missing or unverified")
    if metadata.get("instrument")!="GBPUSD" or metadata.get("source_timeframe")!="M1" or metadata.get("source_price_type")!="bid":
        source_errors.append("instrument/timeframe/price-side provenance does not match required GBPUSD M1 bid")
    startp=ROOT/"reports/runner-started-at-utc.txt"; endp=ROOT/"reports/runner-finished-at-utc.txt"
    start=startp.read_text().strip() if startp.exists() else None; end=endp.read_text().strip() if endp.exists() else None
    requested=metadata.get("requested_end")
    if requested and len(requested)==10: requested=requested+"T23:59:59+00:00"
    closures=metadata.get("scheduled_market_closures",[])
    buckets,raw=reconstruct(); end_dt=parse_utc(end); as_of=end_dt.timestamp()
    result={"schema_version":"1.2","instrument":"GBPUSD","generated_at_utc":datetime.now(timezone.utc).isoformat(),
      "policy":{"open_market_max_age_hours":36,"weekend_max_age_hours":72,"declared_closure_max_age_hours":120,
       "clock_skew_tolerance_seconds":CLOCK_SKEW_SECONDS,"source_timezone":"fixed EST UTC-5 without DST",
       "price_tolerance":TOLERANCE,"aggregation":"independent streaming reconstruction from raw M1"},
      "source_integrity":{"status":"PASS" if not source_errors else "FAIL","raw_m1":raw,"raw_sha256":sha256(RAW),"errors":source_errors},
      "freshness":{},"reconciliation":{},"overall_status":"PASS"}
    for step,tf in ((3600,"H1"),(14400,"H4")):
        latest=max((x for x in buckets[step] if x+step<=as_of),default=None)
        if latest is None: raise ValueError(f"no completed raw-source {tf} candles")
        result["freshness"][tf]=freshness(start,end,requested,datetime.fromtimestamp(latest,timezone.utc).isoformat(),step,closures)
        result["reconciliation"][tf]=reconcile(step,buckets,as_of)
    raw_last=parse_utc(raw["last_m1_utc"]); raw_age=(end_dt-(raw_last+timedelta(minutes=1))).total_seconds(); raw_limit=age_limit(end_dt,closures)
    raw_errors=[]
    if raw_age < -CLOCK_SKEW_SECONDS: raw_errors.append("raw M1 timestamp is in the future beyond clock-skew tolerance")
    if raw_age>raw_limit: raw_errors.append(f"raw M1 is stale: age {raw_age:.0f}s exceeds {raw_limit}s policy")
    result["freshness"]["RAW_M1"]={"status":"PASS" if not raw_errors else "FAIL","latest_m1_utc":raw["last_m1_utc"],
      "age_hours":round(max(0,raw_age)/3600,3),"max_age_seconds":raw_limit,"age_seconds":raw_age,"errors":raw_errors}
    result["source_integrity"]["manifest"]=verify_manifest()
    failed=(result["source_integrity"]["status"]!="PASS" or result["source_integrity"]["manifest"]["status"]!="PASS"
      or any(x["status"]!="PASS" for x in result["freshness"].values())
      or any(x["status"]!="PASS" for x in result["reconciliation"].values()))
    result["overall_status"]="FAIL" if failed else "PASS"
    result["acceptance_gates"]={"source_integrity":"PASS" if result["source_integrity"]["status"]=="PASS" and result["source_integrity"]["manifest"]["status"]=="PASS" else "FAIL",
      "historical_freshness":"PASS" if all(x["status"]=="PASS" for x in result["freshness"].values()) else "FAIL",
      "independent_aggregation":"PASS" if all(x["status"]=="PASS" for x in result["reconciliation"].values()) else "FAIL"}
    base=json.loads(REPORT.read_text()) if REPORT.exists() else {}; base["acceptance_gates"]=result
    if failed: base["status"]="FAIL"
    (ROOT/"reports/acceptance-gates-report.json").write_text(json.dumps(result,indent=2))
    REPORT.write_text(json.dumps(base,indent=2)); print(json.dumps(result,indent=2))
    if failed: sys.exit(1)

if __name__=="__main__": main()
