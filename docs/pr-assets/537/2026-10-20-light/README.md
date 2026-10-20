# PR 537 — light-theme visual evidence

Product source: c353ca7c06a23eab78956437e88373c733620e53.
Captured on Pixel 8, 2026-10-20, using isolated application ID ai.nuphos.android.sentattachmentsfixture. Original screenshots were inspected individually; no recoloring or screenshot alteration was performed.

The app's production source is unchanged at the PR head. Local capture-only differences: the fixture application ID override, forced light theme, system-bar padding, native-window animation settling, additional screenshots, an explicit document-byte assertion label, and a baseline user-text fixture. The exact executed instrumentation source is included here. This is synthetic component evidence, not a full conversation or Play-installed release acceptance.

The baseline fixture reproduces the Surface/Text user-row branch from base 91c28349267738a3649025c00c71458cf719bf89 (apps/android/app/src/main/java/ai/nuphos/android/ui/chat/ConversationScreen.kt) with generated synthetic transfer instructions. It is not a separately built baseline APK. The comparison is baseline user-text rendering versus the current TransferCard component, with surrounding transcript omitted.

The current attachment card and image pager use the production implementations from the PR head. The synthetic repository returns red/blue PNGs and report.txt, without real account credentials or user files. Document saving exercises the real Android CreateDocument result contract with an intercepted owned scoped-storage URI; the actual saved bytes equal "synthetic document". The visible assertion label belongs to the fixture, not the app. The owned document is deleted after the test.

Four instrumentation tests passed in 12.471 seconds: document/card/pager, unavailable/download-failure retry, revoked-access cleanup, and baseline light rendering. device-tests.log is the original instrumentation output. Screenshots include both pager pages; the production pager intentionally retains a black canvas even under the light app theme.

The original Play installation remained ai.nuphos.android 1.0.2 (3), installer com.android.vending, with unchanged first/last installation timestamps. It was not uninstalled, cleared, or overwritten with a development signer. No signing or store submission occurred.

Earlier product-head validation: JVM 285/285, combined attachment/image device fixtures 10/10, release script tests 16/16, release lint and unsigned R8/resource-shrunk bundle validation. Those results remain distinct from this capture-only four-test run.

Yuanlin's visual sign-off is still required before merge. This evidence is not authorization to publish Open testing or Production.
