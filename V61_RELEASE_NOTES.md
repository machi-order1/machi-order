# V61 PRACTICAL HARDENING
Backend live:
- inventory-api v4: latest count + movements AFTER count; unknown stock stays unknown; signed adjustment allowed; company scoped.
- operations-api v5: inventory count item company scoped.
- generate_daily_store_tasks: company scoped; missing inventory count no longer treated as zero; post-count movements included.
Frontend package:
- polished LINE/direct entry with QR token preservation and zero-confusion copy.
- production Netlify unchanged.
Remaining before store test: customer flow wiring to entry screen, authenticated staff E2E, payment/kitchen real-device test, tenant hardening in costing/loss/PL.
