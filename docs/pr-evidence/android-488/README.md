# Android Whisper physical-device evidence

Pixel 8, isolated ai.nuphos.android.whisperfixture APK. Product source matches PR #488 at ce64d966a8b061c5eb81fe8af5bc8d88d27efb5d; only local application ID/name differ for isolation. 283 JVM tests and lint passed. Five device cases passed in each theme. Captures use synthetic settings, audio and OpenAI transport, with zero live transcription requests or messages. The Chinese fixture response is converted from Simplified to Traditional Chinese by the platform ICU implementation.

All ten images were inspected individually. The final captures replace earlier candidates with a password-manager overlay or an unthemed fixture background. Autofill was excluded only within the fixture window, safe insets and a themed Surface were added, and native window transitions were allowed to finish. Production FLAG_SECURE was unchanged.

These captures demonstrate the production composer and settings components with synthetic dependencies. They do not establish real microphone recording, real OpenAI key verification, live transcription quality/billing, or full authenticated production-screen acceptance. No existing phone token/key was read; no real conversation was changed.

Application APK SHA-256: 22cd32c4b748ee2296970bc9f410449eb0c8554e0238e9be8f35432fca2ce02c
Test APK SHA-256: 876880e4b1338f531f10a6c82d7e6b576370e122a9977fe47f49e8b16e60ecc9
Development signing certificate SHA-256: a0e99f4fdcfc952812f45083bf6fc77a50762c5b9d58c9c8103a46a48245aeac

This branch is parented to the reviewed product commit and contains evidence only. Do not merge this assets branch.
