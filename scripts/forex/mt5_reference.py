#!/usr/bin/env python3
"""Validate manual MT5 reference observations; never treats them as OHLC history."""
import json,math
from datetime import datetime
from pathlib import Path

def load_reference(path):
    data=json.loads(Path(path).read_text())
    if data.get("instrument")!="GBPUSD": raise ValueError("reference instrument must be GBPUSD")
    observed=datetime.fromisoformat(data["observation_time"])
    if observed.tzinfo is None: raise ValueError("observation_time must include an explicit UTC offset")
    for tf in ("H1","H4"):
        item=data["timeframes"][tf]
        atr=float(item["atr14_price_units"]); price=float(item.get("displayed_price",data.get("displayed_price",0)))
        if not math.isfinite(atr) or atr<=0 or not math.isfinite(price) or price<=0: raise ValueError(f"invalid {tf} price or ATR")
        if item.get("candle_status") not in ("forming","completed","unknown"): raise ValueError(f"invalid {tf} candle_status")
    return data

def compare_atr(reference_value,historical_value,settings_match=False,tolerance=0.0000001):
    """Only compare when period, broker candle boundary, price basis and ATR method match."""
    if not settings_match: return {"status":"NOT_COMPARABLE","reason":"Matching candle boundaries, price basis and ATR settings have not been established"}
    a=float(reference_value); b=float(historical_value)
    if not all(math.isfinite(x) and x>0 for x in (a,b)): raise ValueError("ATR values must be finite and positive")
    delta=b-a
    return {"status":"PASS" if abs(delta)<=tolerance else "DIFFERENCE","reference":a,"historical":b,
      "difference":delta,"difference_pips":delta/0.0001,"tolerance":tolerance}

if __name__=="__main__":
    import sys
    data=load_reference(sys.argv[1] if len(sys.argv)>1 else "scripts/forex/fixtures/mt5-reference-gbpusd-20261126.json")
    result={"instrument":data["instrument"],"observation_time":data["observation_time"],"source_type":"manual MT5 screenshot observation",
      "historical_comparison":"NOT_COMPARABLE","reason":"Broker server timezone, candle boundaries, chart price basis and MT5 ATR initialization are not established"}
    print(json.dumps(result,indent=2))
