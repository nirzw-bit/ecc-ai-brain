import json,tempfile,unittest
from pathlib import Path
import mt5_reference as m

class MT5ReferenceTests(unittest.TestCase):
    def test_supplied_reference_is_valid_and_explicitly_zoned(self):
        p=Path(__file__).parent/"fixtures/mt5-reference-gbpusd-20261126.json"
        d=m.load_reference(p)
        self.assertEqual(d["instrument"],"GBPUSD")
        self.assertEqual(d["displayed_price"],1.31068)
        self.assertEqual(d["timeframes"]["H1"]["atr14_pips"],11.2)
        self.assertEqual(d["timeframes"]["H4"]["atr14_pips"],26.0)
    def test_unknown_settings_prevent_false_comparison(self):
        self.assertEqual(m.compare_atr(0.00112,0.001313,False)["status"],"NOT_COMPARABLE")
    def test_matching_settings_report_difference_without_forcing_parity(self):
        r=m.compare_atr(0.00112,0.001313,True)
        self.assertEqual(r["status"],"DIFFERENCE")
        self.assertAlmostEqual(r["difference_pips"],1.93,places=5)
    def test_naive_observation_time_is_rejected(self):
        d={"instrument":"GBPUSD","observation_time":"2026-11-26T22:03:00","timeframes":{
          "H1":{"atr14_price_units":0.00112,"displayed_price":1.31068,"candle_status":"forming"},
          "H4":{"atr14_price_units":0.0026,"displayed_price":1.31068,"candle_status":"forming"}}}
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"bad.json"; p.write_text(json.dumps(d))
            with self.assertRaises(ValueError): m.load_reference(p)

if __name__=="__main__": unittest.main()
