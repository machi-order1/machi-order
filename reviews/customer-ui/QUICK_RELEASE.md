# Customer menu quick release

Branch: codex/v71-customer-menu-quick (from main). The full customization branch remains codex/v71-customer-ui.

Quick release changes only index.html and new customer-only CSS/JS. No database, API, payment, kitchen, admin, or service worker edits. Original pick/add/order functions are retained in the quick branch. Do not merge both branches without reconciling index.html.

Left categories: おすすめ、油そば、トッピング、セット・ご飯、単品・おつまみ、アルコール、ソフトドリンク、テイクアウト. Recommendation IDs: 5,6,16,20. Existing takeout opens separately and retains separate payment; current support is 長浜店 only.

Happy hour banner uses API effective price and stock, restricted to alcohol. Current configured rules are daily 11:00–22:00 Japan time; rules are unchanged. Beer 400 yen, highball/lemon sour/shochu 200 yen. Banner refreshes API before adding a drink; final order still uses existing cart confirmation. Closed/stopped/sold-out products cannot be quick-added.

Validation: node tests/customer-promotions.mjs; JavaScript syntax; git diff --check; comparison confirms quick branch pick/add/order functions unchanged from main. Real-device UI and production deployment remain pending. The fragment is an interactive design preview, not a live ordering page. No production changes have been made.
