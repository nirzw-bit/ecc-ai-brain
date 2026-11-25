# GBPUSD historical research acquisition

Isolated workflow for GBPUSD H1/H4 bid and ask candles using the public Dukascopy historical feed through the open-source `dukascopy-node` CLI.

## Execution
- Daily schedule: 17:20 UTC.
- Manual: GitHub Actions → ECC GBPUSD historical acquisition → Run workflow.
- Branch: `feat/ecc-orbit-cloudflare-v1` only.
- Range requested: 2003-05-04 through current time (exclusive end).

## Outputs
- Four raw CSVs: H1/H4 × bid/ask.
- JSON validation report with SHA-256, date coverage, invalid rows, duplicates, gap observations and Wilder ATR(14).
- UTC timestamps in Unix epoch milliseconds, marking candle start.
- ATR calculated from completed candles only and cross-checked with an independent weighted formulation.

## Boundaries and limitations
- Dukascopy is not the user's MT5 broker feed; this dataset does not establish broker-specific spread, commissions, swaps, slippage or execution.
- The community downloader is not affiliated with or endorsed by Dukascopy Bank SA.
- Gaps are surfaced for review because weekends and holidays create legitimate discontinuities.
- The final candle is never assumed complete without its close time passing.
- Workflow artifacts expire after 30 days; this is not permanent database storage.
- No broker credentials, MT5 connection, trade execution, Cloudflare or Supabase changes.
