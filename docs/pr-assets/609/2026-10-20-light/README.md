# PR 609: Android conversation watching evidence

Product head: b3d7fc48cc03880f8c12f3960dfaaeeb9af28c96.
Product commit signature verified by GitHub; author: canyugs.

The 12 product source files match source-manifest.json and the tested M5 checkout.
Product parent 996de6eedbae4710d89911a3a8b7141ae80364a9 has no Android source
differences from the original tested base 03be279608d40f387794bbf4b9f1febfde3b6700.

Seven original light-mode Pixel 8 screenshots were individually inspected.
See validation.md and watch-logs.tar.gz for exact coverage, initial fixture-only
failures, final passing results and cleanup. SHA256SUMS.json covers every other
file in this evidence directory. Do not merge this assets branch.

These are synthetic, intercepted fixtures in an independent package. Real
server subscriptions and FCM delivery were not tested. Menu screenshots use the
production ConversationMenu in a fixture host, not the full conversation layout.
