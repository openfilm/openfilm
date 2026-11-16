---
"openfilm": patch
"@openfilm/desktop": patch
---

Recover stalled hardware video encoders by retrying in software, keep cancellation active during the final encoder flush, and report encoder changes while draft exports run. Handle background update download failures and disable QUIC to avoid Chromium transport errors in the desktop main process. Keep caption rows out of main-track magnet rules and keep captions and media aligned when a selection spanning tracks is moved.
