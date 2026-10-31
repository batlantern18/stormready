# StormReady 1.2.0 — Android build notes

**Build:** version `1.2.0` · versionCode `2` · package `org.stormready.app` · runtimeVersion `1.2.0`

Profiles live in `eas.json`: `production` builds an AAB with auto-incrementing versionCode; `preview` builds an internal-distribution APK. This page covers only what is specific to the Android build — the feature list and product limitations are in `RELEASE_NOTES.md`.

## Google Play — "What's new"

Paste as-is (under the 500-character limit), or trim the last line for a shorter release.

```text
StormReady 1.2.0 — first public release.

Plan for emergencies without an account:
• Household plan, emergency kit, go-bags, medical and communication plans, drills
• Readiness summary showing what is still missing
• Download a map area and route offline; nearby shelters; Florida evacuation zones
• Transfer a plan to another phone by QR code
• English and Spanish; light and dark themes

Everything stays on your device.
```

## Android-specific changes in this build

- **Map contents sheet scrolls again.** The sheet relied on a `maxHeight` clamp that Android did not honour; the `ScrollView` is now bounded directly, so the contents list scrolls instead of clipping. (`31dc45b`)
- **Power tab.** The backup-power planner ships as an embedded offline WebView (single-file HTML bundle) under **Power**, replacing the earlier "PowerPlan" tab name. It works in airplane mode.
- **Notification channels.** Reminder and refill reminders use `LOW` importance with no sound, vibration, or badge; the `alerts` channel stays reserved and unused in 1.2. Channels are created before the permission prompt, which Android requires.
- **Themed icon.** Adaptive icon plus a monochrome layer for Android 13+ themed icons, and a refreshed app logo.
- **TalkBack.** The progress bar is an accessible `progressbar` with label and value, and a test rejects React Native accessibility roles that crash Android at runtime.
- **Permissions asked for:** fine and coarse location only. The camera plugin requests no microphone (`recordAudioAndroid: false`), so QR scanning cannot record audio.
- **QR plan transfer.** The only new camera use: scanning a plan QR code from another device. Transfers stay between the two devices.

## Verification

TypeScript typecheck clean, Expo lint clean, 43 Jest suites / 508 tests passing on the current tree.

Device checks stay manual — airplane-mode routing, notification delivery, the two-device QR round trip, the app lock, and the TalkBack walkthrough at 130% font scale. The checklist is in [`docs/spec/v1.2-release-notes.md`](./spec/v1.2-release-notes.md) §6.
