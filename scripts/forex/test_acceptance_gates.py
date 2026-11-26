import csv, gzip, os, sys, tempfile, unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import acceptance_gates as g

class FreshnessTests(unittest.TestCase):
    def check(self, age_hours, missing=False, future=False, requested="2026-01-07T00:00:00+00:00"):
        end=datetime(2026,1,7,12,tzinfo=timezone.utc); start=end-timedelta(minutes=2)
        last=end-timedelta(hours=age_hours+1)
        if future: last=end+timedelta(minutes=10)
        return g.freshness(end,None if missing else start.isoformat(),end.isoformat(),requested,last.isoformat(),3600,[])
    def test_current_dataset_passes(self): self.assertEqual(self.check(2)["status"],"PASS")
    def test_stale_thirteen_day_dataset_fails(self): self.assertEqual(self.check(13*24)["status"],"FAIL")
    def test_weekend_boundary_uses_weekend_grace(self):
        end=datetime(2026,1,10,12,tzinfo=timezone.utc); last=end-timedelta(hours=49)
        r=g.freshness(end,end.isoformat(),end.isoformat(),"2026-01-09T00:00:00Z",last.isoformat(),3600,[])
        self.assertEqual(r["status"],"PASS")
    def test_declared_holiday_closure_uses_bounded_grace(self):
        end=datetime(2026,1,7,12,tzinfo=timezone.utc); last=end-timedelta(hours=97)
        closure=[{"start_utc":"2026-01-07T00:00:00Z","end_utc":"2026-01-08T00:00:00Z"}]
        r=g.freshness(end,end.isoformat(),end.isoformat(),"2026-01-04T00:00:00Z",last.isoformat(),3600,closure)
        self.assertEqual(r["status"],"PASS"); self.assertEqual(r["max_age_seconds"],120*3600)
    def test_future_candle_fails(self): self.assertEqual(self.check(0,future=True)["status"],"FAIL")
    def test_missing_acquisition_timestamp_fails(self): self.assertEqual(self.check(1,missing=True)["status"],"FAIL")
    def test_requested_end_after_acquisition_fails(self): self.assertEqual(self.check(1,requested="2026-01-09T00:00:00Z")["status"],"FAIL")
    def test_invalid_closure_metadata_fails(self):
        end=datetime(2026,1,7,12,tzinfo=timezone.utc); last=end-timedelta(hours=2)
        r=g.freshness(end,end.isoformat(),end.isoformat(),"2026-01-07T00:00:00Z",last.isoformat(),3600,[{"start_utc":"bad","end_utc":"bad"}])
        self.assertEqual(r["status"],"FAIL")

class ReconstructionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.old=os.getcwd(); os.chdir(self.tmp.name)
        Path("data/raw").mkdir(parents=True); Path("reports").mkdir()
        self.base=datetime(2026,1,5,0,1,tzinfo=timezone.utc)
        self.rows=[(self.base,1.2500,1.2510,1.2490,1.2505),(self.base+timedelta(minutes=1),1.2505,1.2520,1.2500,1.2515),(self.base+timedelta(minutes=2),1.2515,1.2530,1.2510,1.2525)]
        self.write_raw(self.rows); self.buckets,self.meta=g.reconstruct(); self.write_published()
    def tearDown(self): os.chdir(self.old); self.tmp.cleanup()
    def write_raw(self, rows, names=("datetime","open","high","low","close","volume")):
        with gzip.open("data/raw/histdata-gbpusd-m1-est.csv.gz","wt",newline="") as f:
            w=csv.writer(f); w.writerow(names)
            for dt,o,h,l,c in rows:
                est=(dt-timedelta(hours=5)).replace(tzinfo=None); w.writerow([est.strftime("%Y-%m-%d %H:%M:%S"),o,h,l,c,0])
    def write_published(self, alter=None):
        as_of=datetime(2026,1,5,5,tzinfo=timezone.utc).timestamp()
        for step,tf in ((3600,"h1"),(14400,"h4")):
            rows=[]
            for ts,items in self.buckets[step].items():
                if ts+step>as_of: continue
                vals=[x[1] for x in sorted(items)]
                d={"timestamp":ts*1000,"open":vals[0]["open"],"high":max(x["high"] for x in vals),"low":min(x["low"] for x in vals),"close":vals[-1]["close"],"source_m1_count":len(vals)}
                if alter and alter[0]==tf: d[alter[1]]+=alter[2]
                rows.append(d)
            with open(f"data/gbpusd-{tf}-bid.csv","w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["timestamp","open","high","low","close","source_m1_count"]);w.writeheader();w.writerows(rows)
    def asof(self): return datetime(2026,1,5,5,tzinfo=timezone.utc).timestamp()
    def test_h1_and_h4_aggregate_exactly(self):
        self.assertEqual(g.reconcile(3600,self.buckets,self.asof())["status"],"PASS"); self.assertEqual(g.reconcile(14400,self.buckets,self.asof())["status"],"PASS")
    def test_incorrect_open_fails(self):
        self.write_published(("h1","open",0.001)); self.assertEqual(g.reconcile(3600,self.buckets,self.asof())["status"],"FAIL")
    def test_incorrect_high_fails(self):
        self.write_published(("h1","high",0.001)); self.assertEqual(g.reconcile(3600,self.buckets,self.asof())["status"],"FAIL")
    def test_incorrect_low_fails(self):
        self.write_published(("h1","low",-0.001)); self.assertEqual(g.reconcile(3600,self.buckets,self.asof())["status"],"FAIL")
    def test_incorrect_close_fails(self):
        self.write_published(("h4","close",0.001)); self.assertEqual(g.reconcile(14400,self.buckets,self.asof())["status"],"FAIL")
    def test_misaligned_utc_boundary_fails(self):
        p=Path("data/gbpusd-h1-bid.csv"); rows=list(csv.DictReader(p.open())); rows[0]["timestamp"]=str(int(rows[0]["timestamp"])+60000)
        with p.open("w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
        self.assertEqual(g.reconcile(3600,self.buckets,self.asof())["status"],"FAIL")
    def test_source_minute_count_mismatch_fails(self):
        p=Path("data/gbpusd-h1-bid.csv"); rows=list(csv.DictReader(p.open())); rows[0]["source_m1_count"]="4"
        with p.open("w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
        self.assertEqual(g.reconcile(3600,self.buckets,self.asof())["status"],"FAIL")
    def test_duplicate_raw_timestamp_fails(self):
        self.write_raw(self.rows+[self.rows[0]])
        with self.assertRaisesRegex(ValueError,"duplicate"): g.reconstruct()
    def test_out_of_order_raw_records_fail(self):
        self.write_raw([self.rows[1],self.rows[0],self.rows[2]])
        with self.assertRaisesRegex(ValueError,"out-of-order"): g.reconstruct()
    def test_incomplete_final_candle_is_excluded(self):
        r=g.reconcile(14400,self.buckets,datetime(2026,1,5,1,30,tzinfo=timezone.utc).timestamp()); self.assertEqual(r["raw_reconstructed_candles"],0)
    def test_fixed_est_timezone_conversion(self):
        self.assertEqual(next(iter(self.buckets[3600])),int(self.base.replace(minute=0).timestamp())); self.assertEqual(self.meta["source_timezone"],"fixed EST UTC-5")
    def test_raw_hash_changes_when_source_changes(self):
        before=g.sha256(Path("data/raw/histdata-gbpusd-m1-est.csv.gz")); self.write_raw(self.rows[:2]); self.assertNotEqual(before,g.sha256(Path("data/raw/histdata-gbpusd-m1-est.csv.gz")))
    def test_missing_raw_file_fails(self):
        Path("data/raw/histdata-gbpusd-m1-est.csv.gz").unlink()
        with self.assertRaisesRegex(ValueError,"missing"): g.reconstruct()
    def test_wrong_raw_schema_fails(self):
        self.write_raw(self.rows,names=("time","o","h","l","c","volume"))
        with self.assertRaisesRegex(ValueError,"schema"): g.reconstruct()
    def test_empty_raw_dataset_fails(self):
        self.write_raw([])
        with self.assertRaisesRegex(ValueError,"empty"): g.reconstruct()

if __name__=="__main__": unittest.main()
