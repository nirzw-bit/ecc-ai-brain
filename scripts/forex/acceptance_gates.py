#!/usr/bin/env python3
"""Strict GBPUSD freshness and independent raw-M1 reconciliation gates.

HistData timestamps are naive fixed EST (UTC-5, no DST). Its M1 export is
sparse: only provider-supplied minute bars are aggregated; no missing bars
are synthesized. H1/H4 buckets are UTC epoch-aligned, left-closed/left-labelled.
"""
import csv, gzip, hashlib, json, math, sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(".")
REPORT=ROOT/"reports/gbpusd-validation-report.json"
RAW=ROOT/"data/raw/histdata-gbpusd-m1-est.csv.gz"
TOLERANCE=0.000005       # half of the smallest 1e-5 source price increment
CLOCK_SKEW_SECONDS=300
OPEN_MAX_AGE=36*3600
WEEKEND_MAX_AGE=72*3600
DECLARED_CLOSURE_MAX_AGE=120*3600
EST=timezone(timedelta(hours=-5))
FIELDS=("open","high","low","close")

def parse_utc(value):
    if not value: raise ValueError("missing UTC timestamp")
    dt=datetime.fromisoformat(value.replace("Z","+00:00"))
    if dt.tzinfo is None: raise ValueError("timestamp must include timezone")
    return dt.astimezone(timezone.utc)

def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()

def freshness(now, acquisition_start, acquisition_end, requested_end, latest, step, closures):
    errors=[]
    if not acquisition_start or not acquisition_end: errors.append("missing acquisition start/completion timestamp")
    if not requested_end: errors.append("missing requested coverage end")
    try:
        start=parse_utc(acquisition_start); end=parse_utc(acquisition_end)
        req=parse_utc(requested_end)
        last=parse_utc(latest)
        if start>end: errors.append("acquisition start occurs after completion")
        if (end-start).total_seconds()>6*3600: errors.append("acquisition duration exceeds 6-hour safety bound")
        if (last+timedelta(seconds=step)-end).total_seconds()>CLOCK_SKEW_SECONDS:
            errors.append("latest completed candle is in the future beyond clock-skew tolerance")
        age=max(0,(end-(last+timedelta(seconds=step))).total_seconds())
        weekend=end.weekday()>=5
        declared=False
        for c in closures or []:
            try:
                cs=parse_utc(c.get("start_utc")); ce=parse_utc(c.get("end_utc"))
                if cs<=end<=ce: declared=True
            except Exception: errors.append("invalid scheduled closure metadata")
        limit=DECLARED_CLOSURE_MAX_AGE if declared else WEEKEND_MAX_AGE if weekend else OPEN_MAX_AGE
        if age>limit: errors.append(f"stale completed candle: age {age:.0f}s exceeds {limit}s policy")
        if req.date()>end.date(): errors.append("acquisition completion precedes requested coverage end date")
        if last.date()<req.date()-timedelta(days=1): errors.append("latest candle coverage ends before requested acquisition period")
        return {"status":"PASS" if not errors else "FAIL","age_seconds":age,
          "age_hours":round(age/3600,3),"max_age_seconds":limit,
          "latest_completed_candle_start_utc":last.isoformat(),
          "latest_completed_candle_end_utc":(last+timedelta(seconds=step)).isoformat(),
          "requested_end_utc":req.isoformat(),"acquisition_start_utc":start.isoformat(),
          "acquisition_completion_utc":end.isoformat(),"errors":errors}
    except Exception as e:
        errors.append(str(e))
        return {"status":"FAIL","errors":errors}

def reconstruct():
    if not RAW.exists(): raise ValueError("raw M1 gzip file missing")
    buckets={3600:defaultdict(list),14400:defaultdict(list)}
    raw_count=0; duplicates=0; out_of_order=0; previous=None; min_ts=None; max_ts=None
    with gzip.open(RAW,"rt",encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        required={"datetime","open","high","low","close"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(f"raw M1 CSV schema invalid: {reader.fieldnames}")
        seen=set()
        for line,row in enumerate(reader,2):
            dt=datetime.strptime(row["datetime"],"%Y-%m-%d %H:%M:%S").replace(tzinfo=EST).astimezone(timezone.utc)
            ts=int(dt.timestamp())
            if ts in seen: duplicates+=1
            if previous is not None and ts<previous: out_of_order+=1
            seen.add(ts); previous=ts
            vals={k:float(row[k]) for k in FIELDS}
            if not all(math.isfinite(v) and v>0 for v in vals.values()) or vals["high"]<max(vals.values()) or vals["low"]>min(vals.values()):
                raise ValueError(f"invalid raw M1 OHLC at line {line}")
            min_ts=ts if min_ts is None else min(min_ts,ts)
            max_ts=ts if max_ts is None else max(max_ts,ts)
            for step in (3600,14400):
                buckets[step][(ts//step)*step].append((ts,vals))
            raw_count+=1
    if raw_count==0: raise ValueError("raw M1 dataset is empty")
    if duplicates: raise ValueError(f"raw M1 contains {duplicates} duplicate timestamps")
    if out_of_order: raise ValueError(f"raw M1 contains {out_of_order} out-of-order records")
    return buckets,{"row_count":raw_count,"first_m1_utc":datetime.fromtimestamp(min_ts,timezone.utc).isoformat(),
      "last_m1_utc":datetime.fromtimestamp(max_ts,timezone.utc).isoformat(),
      "duplicate_timestamps":duplicates,"out_of_order_records":out_of_order,"source_timezone":"fixed EST UTC-5"}

def reconcile(step, buckets, as_of):
    tf="h1" if step==3600 else "h4"
    published=ROOT/f"data/gbpusd-{tf}-bid.csv"
    if not published.exists(): return {"status":"FAIL","error":f"published {tf} bid file missing"}
    expected={}
    for start,records in buckets[step].items():
        if start+step>as_of: continue
        records.sort(key=lambda x:x[0])
        vs=[x[1] for x in records]
        expected[start]={"open":vs[0]["open"],"high":max(x["high"] for x in vs),
          "low":min(x["low"] for x in vs),"close":vs[-1]["close"],"source_m1_count":len(vs)}
    actual={}; duplicates=0; errors=[]
    with published.open(newline="",encoding="utf-8-sig") as f:
        r=csv.DictReader(f)
        required={"timestamp",*FIELDS,"source_m1_count"}
        if not r.fieldnames or not required.issubset(r.fieldnames):
            return {"status":"FAIL","error":f"published {tf} CSV schema invalid"}
        for line,row in enumerate(r,2):
            ts=int(float(row["timestamp"])/1000)
            if ts in actual: duplicates+=1; continue
            actual[ts]={**{k:float(row[k]) for k in FIELDS},"source_m1_count":int(row["source_m1_count"])}
    missing=sorted(set(expected)-set(actual)); extra=sorted(set(actual)-set(expected))
    mismatches=[]
    for ts in sorted(set(expected)&set(actual)):
        a=actual[ts]; e=expected[ts]
        bad={k:{"expected":e[k],"actual":a[k]} for k in FIELDS if abs(e[k]-a[k])>TOLERANCE}
        if e["source_m1_count"]!=a["source_m1_count"]: bad["source_m1_count"]={"expected":e["source_m1_count"],"actual":a["source_m1_count"]}
        if bad: mismatches.append({"timestamp_utc":datetime.fromtimestamp(ts,timezone.utc).isoformat(),"fields":bad})
    if duplicates: errors.append(f"{duplicates} duplicate published candle timestamps")
    if missing: errors.append(f"{len(missing)} reconstructed candles missing from published file")
    if extra: errors.append(f"{len(extra)} published candles have no raw M1 source records")
    if mismatches: errors.append(f"{len(mismatches)} candles differ from independent reconstruction")
    return {"timeframe":tf.upper(),"status":"PASS" if not (errors or duplicates) else "FAIL",
      "raw_reconstructed_candles":len(expected),"published_candles":len(actual),
      "missing_candles":len(missing),"extra_candles":len(extra),"duplicate_published_timestamps":duplicates,
      "mismatched_candles":len(mismatches),"price_tolerance":TOLERANCE,
      "missing_examples":[datetime.fromtimestamp(x,timezone.utc).isoformat() for x in missing[:10]],
      "extra_examples":[datetime.fromtimestamp(x,timezone.utc).isoformat() for x in extra[:10]],
      "mismatch_examples":mismatches[:10],"errors":errors}

def main():
    now=datetime.now(timezone.utc)
    start_file=ROOT/"reports/runner-started-at-utc.txt"
    end_file=ROOT/"reports/runner-finished-at-utc.txt"
    metadata=json.loads((ROOT/"reports/source-metadata.json").read_text())
    start=start_file.read_text().strip() if start_file.exists() else None
    end=end_file.read_text().strip() if end_file.exists() else None
    if not end: end=now.isoformat()
    requested=metadata.get("requested_end")
    if requested and len(requested)==10: requested=requested+"T23:59:59+00:00"
    closures=metadata.get("scheduled_market_closures",[])
    buckets,raw=reconstruct()
    try: raw_latest=datetime.fromisoformat(raw["last_m1_utc"]).astimezone(timezone.utc)
    except Exception: raw_latest=None
    result={"schema_version":"1.0","instrument":"GBPUSD","generated_at_utc":now.isoformat(),
      "policy":{"open_market_max_age_hours":36,"weekend_max_age_hours":72,
       "declared_closure_max_age_hours":120,"clock_skew_tolerance_seconds":CLOCK_SKEW_SECONDS,
       "source_timezone":"fixed EST UTC-5 without DST","price_tolerance":TOLERANCE,
       "note":"HistData M1 is sparse provider output; aggregation verifies every supplied source record and source_m1_count. It does not invent absent minute bars."},
      "source_integrity":{"status":"PASS","raw_m1":raw,"raw_sha256":sha256(RAW)},
      "freshness":{},"reconciliation":{},"overall_status":"PASS"}
    for tf,step in (("H1",3600),("H4",14400)):
        # Find latest completed candle reconstructed from raw source.
        latest=max((x for x in buckets[step] if x+step<=parse_utc(end).timestamp()),default=None)
        if latest is None: raise ValueError(f"no completed raw-source {tf} candles")
        result["freshness"][tf]=freshness(now,start,end,requested,
          datetime.fromtimestamp(latest,timezone.utc).isoformat(),step,closures)
        result["reconciliation"][tf]=reconcile(step,buckets,parse_utc(end).timestamp())
    if raw_latest is None: raise ValueError("cannot determine raw M1 freshness")
    raw_age=(parse_utc(end)-(raw_latest+timedelta(minutes=1))).total_seconds()
    result["freshness"]["RAW_M1"]={"status":"PASS" if raw_age<=OPEN_MAX_AGE else "FAIL",
      "latest_m1_utc":raw["last_m1_utc"],"age_hours":round(raw_age/3600,3),
      "max_age_hours":OPEN_MAX_AGE/3600,"age_seconds":raw_age,
      "errors":[] if raw_age<=OPEN_MAX_AGE else ["raw M1 source is stale"]}
    failed=any(x["status"]!="PASS" for x in result["freshness"].values()) or any(x["status"]!="PASS" for x in result["reconciliation"].values())
    result["overall_status"]="FAIL" if failed else "PASS"
    result["acceptance_gates"]={"source_integrity":"PASS","historical_freshness":"PASS" if all(x["status"]=="PASS" for x in result["freshness"].values()) else "FAIL",
      "independent_aggregation":"PASS" if all(x["status"]=="PASS" for x in result["reconciliation"].values()) else "FAIL"}
    REPORT.parent.mkdir(exist_ok=True,parents=True)
    if REPORT.exists():
        base=json.loads(REPORT.read_text())
    else: base={}
    base["acceptance_gates"]=result
    if failed: base["status"]="FAIL"
    (ROOT/"reports/acceptance-gates-report.json").write_text(json.dumps(result,indent=2))
    REPORT.write_text(json.dumps(base,indent=2))
    print(json.dumps(result,indent=2))
    if failed: sys.exit(1)

if __name__=="__main__":
    main()
