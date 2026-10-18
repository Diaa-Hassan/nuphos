# Supplemental real microphone validation — PR #488

Product head: ce64d966a8b061c5eb81fe8af5bc8d88d27efb5d (unchanged, approved). All original 14 changed source files in the physical-device build were rechecked against the prior SHA-256 manifest and remain identical. Only an additional instrumentation test was compiled in the isolated local fixture test APK.

Pixel 8, isolated package ai.nuphos.android.whisperfixture. Existing fixed development signer and Android user-home configuration retained. No real app data, key or token was read or modified. No product source, production FLAG_SECURE, global audio volume or mute setting changed. The original fixture microphone grant=false and permission flags were restored and compared exactly. No Gradle/instrumentation process remained at handoff.

Four cases passed: permission denial creates no take; real MediaRecorder finish produces mono AAC in an M4A container at 16 kHz; cancel deletes audio and releases the microphone for another take; the production VoiceInput controller connected to the real recorder handles an intentional in-process transcription failure, suppresses duplicate Finish, appends nothing and deletes audio. The final finish test sampled maxAmplitude repeatedly after its initial baseline read and passed with a nonzero peak.

Final observed take: 1,280,000 microseconds, 39,201 bytes, audio/mp4a-latm, 16,000 Hz, one channel, peak normalized amplitude 0.045655690133571625. The take was deleted locally and the fixture cache contained no dictation-* files afterward.

Test source generates a 440 Hz PCM tone via AudioTrack during brief real ambient-microphone captures (no spoken test content). Acoustic isolation and the exact recorded content were not established. No recording was exported, listened to, transcribed, or uploaded. Only source and numeric metadata are included here. The transport is an in-process throwing stub, with no HTTP client or real key store.

Still untested: real OpenAI key verification and paid transcription/upload, recognition quality, a full authenticated production conversation, OS permission-dialog interaction (the temporary grant used adb), long-duration/max-size limits, and lifecycle backgrounding with a real microphone. No live API testing or merge/release is authorized by this report. Maintainer visual sign-off remains a separate gate managed by the parent conversation.
