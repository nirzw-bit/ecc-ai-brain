# ECC Operations Controller — isolated prototype

This is a planning-only state machine for coordinating three ECC roles without consuming additional ChatGPT automation slots. It is deliberately offline and makes no production changes. It does not schedule itself or invoke external services.

## Safety gates
- The three existing ChatGPT roles remain unchanged.
- Independent Auditor is read-only.
- Reliability cannot start until archive verification is PASS.
- Reliability requires 24 hours of recorded observation and a final review.
- Efficiency Challenge remains isolated and cannot start until Reliability is PASS.
- Unknown states and timezone-naive timestamps are rejected.

## Test
From this directory, run:

```bash
python -m unittest discover -s tests -v
```

Only the Python standard library is required. No credentials, network access, or production environment are used.

## Not yet implemented
- Persistent task/evidence storage
- A scheduler or Edge Function
- Notifications or ChatGPT auto-wakeup
- Any production API calls

These require separate security review and verification before activation.
