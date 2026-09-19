# V64 FRONTLINE
- Cashier rebuilt as app-first UI using authenticated cashier-api v2.
- Only Cash / PayPay exposed in frontline UI.
- Confirmation before payment; backend atomic payment remains source of truth.
- 7-second unpaid-order refresh.
- Store home rebuilt around frontline tasks, not admin tables.
- Kitchen is primary action; cashier/today/inventory/hygiene are one tap away.
- Shared PWA bottom navigation.
- Production Netlify unchanged.
