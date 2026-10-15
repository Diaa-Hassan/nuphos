# Android unlink — synthetic Pixel 8 visual evidence

Product PR: #407. Approved product head remains `97177418bd06533a576a2f63ce1cfd87f95cd630`.

All captures are unedited physical Pixel 8 screenshots of the approved, unchanged installed development APK (SHA-256 `17a2ecbb43bb7f64f721ef5c6bbceca24442b90686e7fa524a8e3594c1d023c7`). Only a local-only capture method was added to the separate instrumentation package. All transport was intercepted with synthetic rows and responses. No real conversations, account identities, message content or credentials were published.

Each theme has four captures: `light-rows.png`, `light-confirmation.png`, `light-busy.png`, `light-error.png`, and the corresponding `dark-*` files. The busy captures show disabled Cancel/Unlinking buttons while the intercepted request waits. The error captures use a synthetic 403 and preserve the tree. `dark-success-root.png` is the earlier inspected successful synthetic root-promotion capture.

The targeted capture method passed once per theme; the already-passed full test suite was not rerun for evidence. Original preference/auth/draft/push-binding fingerprints, dark mode and auto-rotation were restored. No app reinstall, data clear, real unlink, inference or sharing change was performed during capture. Existing test packages were retained.

Code approval is recorded on the product PR. Human visual sign-off, including inline action density and explicit confirmation, remains pending. This evidence branch does not change the approved product head.
