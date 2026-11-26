# GBPUSD historical research acquisition

Isolated, demo-research-only GBPUSD historical acquisition on `feat/ecc-orbit-cloudflare-v1`.

## Execution
- Daily schedule: 17:20 UTC.
- Manual: GitHub Actions → ECC GBPUSD historical acquisition → Run workflow.
- Requested range: provider start through current UTC acquisition date.
- Artifacts expire after 30 days; no permanent database or production storage.

## Acceptance gates
1. **Source integrity:** raw M1 gzip CSV, exact provider metadata, reproducible SHA-256, verified CSV schema and fixed EST timezone.
2. **Freshness:** age is measured from the end of the latest completed candle to acquisition completion. Maximum age is 36 hours during normal weekdays, 72 hours across weekend closure, and 120 hours only when a bounded scheduled closure interval is explicitly recorded. Future candles beyond five minutes of clock skew fail. Missing acquisition timestamps fail. A requested-end date is recorded and enforced.
3. **Independent aggregation:** a separate standard-library CSV/gzip implementation parses HistData naive timestamps as fixed EST (UTC-5, no DST), converts to UTC, buckets by UTC epoch boundaries, and reconstructs OHLC from raw M1. It compares every H1/H4 timestamp, OHLC value and source M1 count with published files. Price tolerance is 0.000005.
4. **Technical validation:** existing OHLC, duplicate, timestamp, SHA-256 and Wilder ATR(14) checks remain mandatory.

HistData M1 is a sparse provider export, not a guaranteed one-row-per-clock-minute tape. The independent verifier does not invent absent minutes or require 60/240 rows in every candle; it proves that every provider-supplied M1 record was included exactly once and that published candle OHLC and `source_m1_count` match that raw source. Missing/duplicate/out-of-order source records, missing/extra candles and mismatches fail.

## Source limitations
- Dukascopy is attempted first; HistData.com is used only when the Dukascopy attempt fails.
- Provenance records the actual selected provider, not merely the first attempted source.
- HistData M1 OHLC is bid-only. Ask series are never synthesized.
- This is not an MT5 broker feed and does not establish broker-specific spreads, commission, swaps, slippage or execution.
- No broker credentials, MT5 connection, order execution, Cloudflare/Supabase changes or production deployment.
- DCA/grid strategy research remains blocked until every mandatory acceptance gate passes.
