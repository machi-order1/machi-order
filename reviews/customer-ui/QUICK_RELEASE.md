# Customer menu quick release

Branch: codex/v71-customer-menu-quick (from main). The full customization branch remains codex/v71-customer-ui.

Quick release changes only index.html and new customer-only CSS/JS. No database, API, payment, kitchen, admin, or service worker edits. Original order payload and API calls are retained. A successful-order display hook pins alcohol reordering. Do not merge both branches without reconciling index.html.

Left categories: おすすめ、油そば、トッピング、セット・ご飯、単品・おつまみ、アルコール、ソフトドリンク、テイクアウト. Recommendation IDs: 5,6,16,20. Existing takeout opens separately and retains separate payment; current support is 長浜店 only.

Happy hour banner uses API effective price and stock, restricted to alcohol. Current configured rules are daily 11:00–22:00 Japan time; rules are unchanged. Beer 400 yen, highball/lemon sour/shochu 200 yen. Banner refreshes API before adding a drink; final order still uses existing cart confirmation. Closed/stopped/sold-out products cannot be quick-added.

Validation: node tests/customer-promotions.mjs; JavaScript syntax; git diff --check; order payload and API calls preserved; pinning only follows successful submission. Real-device UI and production deployment remain pending. The fragment is an interactive design preview, not a live ordering page. No production changes have been made.

Alcohol banner pins only after a successful real alcohol order, not cart addition or test orders. State is scoped to the seat token in sessionStorage (same device/tab; no cross-device customer identification or checkout reset). A new tab/session starts fresh; reload retains state. After happy hour it shows current regular prices. Closed/stopped ordering hides the entry. ResizeObserver offsets category navigation below the sticky banner; modal remains above it. Production not deployed.

Sidebar adds おかわり (choose alcohol/soft drink category; no automatic repeat order) before takeout, and 会計案内 at the bottom. Checkout guidance directs guests to staff and warns of unsent cart items. It does not call staff, show a bill total, or process payment; existing staff cashier remains unchanged.
