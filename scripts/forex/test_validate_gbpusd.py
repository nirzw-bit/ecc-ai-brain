import csv, tempfile, unittest
from pathlib import Path
from validate_gbpusd import parse_epoch, read

class TimestampValidationTests(unittest.TestCase):
    def test_epoch_seconds(self):
        ts, unit = parse_epoch("959724000")
        self.assertEqual(unit, "s")
        self.assertEqual(ts, 959724000)

    def test_epoch_milliseconds(self):
        ts, unit = parse_epoch("959724000000")
        self.assertEqual(unit, "ms")
        self.assertEqual(ts, 959724000)

    def test_rejects_1970_timestamp(self):
        with self.assertRaises(ValueError):
            parse_epoch("959724")

    def test_rejects_future_timestamp(self):
        with self.assertRaises(ValueError):
            parse_epoch("9999999999999")

    def test_duplicate_and_invalid_ohlc_are_detected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "sample.csv"
            with path.open("w", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["timestamp","open","high","low","close"])
                writer.writerow([959724000,1.2,1.3,1.1,1.25])
                writer.writerow([959724000,1.2,1.3,1.1,1.25])
                writer.writerow([959727600,1.2,1.1,1.15,1.25])
            rows, errors, duplicates, gaps, units = read(path, 3600)
            self.assertEqual(len(rows), 1)
            self.assertEqual(duplicates, 1)
            self.assertEqual(len(errors), 1)
            self.assertEqual(units, ["s"])

if __name__ == "__main__":
    unittest.main()
