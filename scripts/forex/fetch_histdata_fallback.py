#!/usr/bin/env python3
"""HistData M1 fallback: preserve source bars and aggregate bid H1/H4 in UTC."""
import json, sys
from datetime import date, datetime, timezone
from pathlib import Path
import pandas as pd
from histdata_fetcher import fetch_data, get_available_pairs, __version__

DATA=Path("data"); RAW=DATA/"raw"; REPORTS=Path("reports")
RAW.mkdir(parents=True,exist_ok=True); REPORTS.mkdir(parents=True,exist_ok=True)

def main():
    catalog=get_available_pairs("1min",resolve_end_date=False)
    if "GBPUSD" not in catalog:
        raise RuntimeError("HistData pair catalogue does not include GBPUSD")
    start=catalog["GBPUSD"].start_date.isoformat()
    end=date.today().isoformat()
    result=fetch_data("GBPUSD",start,end,"1min",output_format=None,max_workers=3)
    if not result.ok:
        raise RuntimeError("HistData returned no GBPUSD M1 rows")
    if result.failed_periods:
        failed=[{"period":x.period_label,"reason":x.reason} for x in result.failed_periods]
        raise RuntimeError("HistData period retrieval incomplete: "+json.dumps(failed[:20]))
    frame=result.data.copy()
    if frame.empty or not {"datetime","open","high","low","close"}.issubset(frame.columns):
        raise RuntimeError("HistData returned an unexpected M1 schema")
    # Preserve provider M1 values and their original fixed-EST timestamps before conversion.
    raw_path=RAW/"histdata-gbpusd-m1-est.csv.gz"
    frame.to_csv(raw_path,index=False,compression="gzip")
    # HistData explicitly defines timestamps as EST (UTC-5) without DST.
    frame["datetime"]=pd.to_datetime(frame["datetime"],errors="raise")
    frame=frame.sort_values("datetime").drop_duplicates(subset=["datetime"],keep="first")
    frame=frame.set_index("datetime")
    frame.index=frame.index.tz_localize("Etc/GMT+5").tz_convert("UTC")
    frame=frame[["open","high","low","close"]].astype(float)
    now=pd.Timestamp.now(tz="UTC")
    outputs=[]
    for tf,rule,seconds in [("h1","1h",3600),("h4","4h",14400)]:
        grouped=frame.resample(rule,label="left",closed="left",origin="start_day").agg(
            open=("open","first"),high=("high","max"),low=("low","min"),close=("close","last"))
        counts=frame["close"].resample(rule,label="left",closed="left",origin="start_day").count()
        grouped["source_m1_count"]=counts
        grouped=grouped.dropna(subset=["open","high","low","close"])
        grouped=grouped[grouped.index+pd.Timedelta(seconds=seconds)<=now]
        out=pd.DataFrame({
            "timestamp":(grouped.index.as_unit("ns").asi8//1_000_000).astype("int64"),
            "open":grouped["open"].values,"high":grouped["high"].values,
            "low":grouped["low"].values,"close":grouped["close"].values,
            "source_m1_count":grouped["source_m1_count"].astype(int).values})
        path=DATA/f"gbpusd-{tf}-bid.csv"
        out.to_csv(path,index=False)
        outputs.append({"timeframe":tf.upper(),"file":str(path),"rows":len(out),
                        "first_utc":grouped.index[0].isoformat() if len(grouped) else None,
                        "last_utc":grouped.index[-1].isoformat() if len(grouped) else None,
                        "source":"HistData M1 bid OHLC aggregated to UTC candle boundaries"})
    metadata={
        "provider":"HistData.com","client":"histdata-fetcher","client_version":__version__,
        "instrument":"GBPUSD","source_timeframe":"M1","source_price_type":"bid",
        "source_timezone":"EST fixed UTC-5 without DST","normalized_timezone":"UTC",
        "requested_start":start,"requested_end":end,
        "fetched_periods":result.fetched_periods,"failed_periods":[],
        "raw_source_file":str(raw_path),"derived_outputs":outputs,
        "aggregation":"UTC-aligned H1/H4; first open, maximum high, minimum low, last close",
        "ask_ohlc_available":False,
        "limitation":"HistData M1 OHLC is bid-only. Ask history is not fabricated; ask/bid tick history is a separate possible retrieval."
    }
    (REPORTS/"source-metadata.json").write_text(json.dumps(metadata,indent=2),encoding="utf-8")
    print(json.dumps(metadata,indent=2))
    if not all(x["rows"]>0 for x in outputs):
        sys.exit("No usable derived H1/H4 records")

if __name__=="__main__":
    main()
