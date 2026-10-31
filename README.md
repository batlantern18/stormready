# StormReady

StormReady is a local-first emergency preparedness app for households in the United States and Mexico. It helps a household build an emergency plan, keep supplies current, coordinate with one another, and check official local guidance. Plan data stays on the device; there is no account, and no server stores it.

StormReady is a planning aid, not an emergency alert authority. Follow current directions from local emergency management and confirm shelter availability before traveling.

## What the app covers

Six tabs — **Home**, **Prepare**, **Map**, **Updates**, **Power**, **Settings** — plus onboarding and screens for the kit, inventory, go-bags, medical needs, communication plan, drills, readiness summary, and plan transfer. The interface runs in English and Spanish, in light and dark themes.

`docs/FEATURES.md` describes each screen and behavior in detail.

## Documentation

| Read this | For |
|---|---|
| `docs/FEATURES.md` | What each screen does, and the scope of each feature |
| `docs/maps-architecture.md` | How the Map tab, offline packs, on-device routing, and zone lookup work |
| `GLOSSARY.md` | Domain terms (kit, go-bag, drill, readiness score, plan file) — use these in issues, ADRs, and UI copy |
| `docs/adr/` | Decisions already made, and why |
| `docs/spec/` | Build specs for shipped releases — historical plans, not current behavior |
| `RELEASE_NOTES.md` | What shipped in each release |
| `AGENTS.md` | Build, lint, and navigation rules for coding agents and contributors |

## Run in development

```sh
npm install
npm start
```

MapLibre ships native code, so use an Android development build (`npm run android`) or an installed development client. Expo Go does not include the map module. Address search and new map downloads need an internet connection.

## Build an installable Android APK

The EAS `preview` profile produces an APK rather than an app bundle. After signing in to Expo:

```sh
cd scripts
./build-apk.sh
```

EAS builds in the cloud and prints a download link when the build finishes. Cloud builds need an Expo account and network access. For a local Gradle build, install Android Studio and the Android SDK, then run `npx expo run:android`; `android/` is generated, so never edit it by hand.

## Quality checks

Run all five before opening a pull request:

```sh
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run doctor
```

CI runs the same gates on every push and pull request. Coverage floors are enforced per directory; the numbers live in `package.json` under `jest.coverageThreshold`.

`fetch` is blocked globally in `jest.setup.js`, so no test can reach the network — mock `globalThis.fetch` when a test needs a response. Suites live in `__tests__/`.

Location, maps, notifications, QR scanning, and file import/export need a manual pass on a physical device. Emulators do not fully cover notification channels, background delivery, map rendering, or platform file pickers.

## Over-the-air updates

The app uses EAS Update, and the `preview` and `production` build profiles use matching update channels.

```sh
npx eas-cli@latest update --channel preview --message "Describe the change"
npx eas-cli@latest update --channel production --message "Describe the change"
```

OTA updates cannot add native modules or change native configuration. Confirm the installed build's `runtimeVersion` matches before publishing; native changes need a new build.

## Scope and data

- Offline map packs are capped at 3,000 tiles and 50 MB per download.
- Offline routes work only inside the road area saved on the device. They do not include live traffic, closures, or turn restrictions.
- U.S. shelter data may come from FEMA; Mexico listings may rely on community-mapped data. Confirm a shelter is open and has space with local authorities.
- Automated evacuation-zone lookup is available only in Florida. Elsewhere, use the zone published by your local emergency authority.
- Location is requested only after you choose a location-based action. Plan data stays on the device unless you export or share it; transfers go device to device by QR code or `.stormready-plan` file, with no server involved.

Preparedness references: [FEMA](https://www.fema.gov/emergency-managers), [National Weather Service](https://www.weather.gov/), [Ready.gov](https://www.ready.gov/), [Mexico Protección Civil](https://www.gob.mx/proteccioncivil), [Mexico National Weather Service (SMN)](https://smn.conagua.gob.mx/es/), and [CENAPRED National Risk Atlas](https://www.atlasnacionalderiesgos.gob.mx/).
