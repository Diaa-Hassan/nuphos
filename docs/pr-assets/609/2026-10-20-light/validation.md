# Android Watch / Unwatch validation — 2026-10-20

Base: `03be279608d40f387794bbf4b9f1febfde3b6700`.
Branch: `feat/android-watch-unwatch`.
Source manifest SHA256: `7580f183c867a7896c43f02ca8804f0a39f5dfba5bace98d2a7813a050c50230`.
All 12 changed/new source file hashes match the tested M5 checkout.

Original package: 292 JVM tests, zero failures/errors/skips; lintDebug,
assembleDebug and assembleDebugAndroidTest passed. No original-package APK
was installed. Independent fixture package built using a local Gradle init
script; the init script only overrides applicationId/testApplicationId.

Pixel 8, isolated `ai.nuphos.android.watchfixture`: 4 tests passed in 10.123s.
The first attempt had two fixture failures because a child without explicit
shared ownership was sorted into another section; the fixture now explicitly
marks parent and child as shared readers. Final results are device-rerun.log.

Coverage: shared read-only reader list/menu Watch and Unwatch; server-read
cascade; explicit failure/retry; duplicate request suppression and late response
after team switch; legacy missing watching field in list/menu. JVM tests also
cover malformed confirmation, URI encoding, optional decoding, stale detail
invalidation and access revocation. Every HTTP request is intercepted; these
results do not prove real server subscriptions or FCM transport delivery.

Seven original light screenshots were visually inspected individually:
- list-before: shared parent and child both expose Unwatch; titles and controls
  are readable, with normal line wrapping and no overlap.
- list-after-cascade: both expose Watch after server reload. This is a state
  before/after pair for the same final implementation, not a previous-build comparison.
- shared-menu-watch: shared reader sees Share/Pin/Watch, with no owner-only Rename.
- shared-menu-unwatch: after Watch, the same menu exposes Unwatch.
- legacy-list: no Watch/Unwatch appears when the server omits watching.
- legacy-menu: Share/Pin remain; Watch/Unwatch is absent.
- failure-retry: readable error dialog with Refresh; previous watched state is
  retained until the explicit successful retry.

Menu screenshots use the production ConversationMenu in an isolated component
host; they are not evidence of full live conversation navigation or chat layout.
System theme and orientation settings were never changed. The fixture is forced
light locally. No FLAG_SECURE changes, real session subscription changes or test
notifications were made.

Cleanup: fixture and test packages force-stopped; no Gradle/instrument/screenrecord
process remained. Play installation codePath, versionCode 3 and versionName 1.0.2
were unchanged. System settings remained night mode 2, accelerometer rotation 1,
user rotation 0. M5 + Pixel 8 slot explicitly released to the main session.

Published product head: b3d7fc48cc03880f8c12f3960dfaaeeb9af28c96 (verified signed).
PR: https://github.com/nuphos/nuphos/pull/609 .
Pending: CI and formal non-author review. Assets are published on a separate,
verified signed branch and must never be merged into the product branch.
