# StormReady

StormReady is a local-first preparedness app for the United States and Mexico. Household details, checklist progress, destinations, and saved places stay in app storage on the device. Its MapLibre map uses OpenStreetMap-derived data and can save an interactive offline area. In the U.S., nearby shelter listings come from FEMA; in Mexico, they come from community-mapped OpenStreetMap listings. Florida addresses can use Florida's official evacuation-zone lookup and county map; other locations should use their local emergency authority for current zones and orders.

## What's in v1.1 "Ready Kit"

- **First-run onboarding:** four steps for household, zone, and a ready summary. Setup can be skipped at every step, and location permission is not requested during onboarding.
- **Household-sized emergency kit:** every line shows its quantity, the basis for that number, and an official source. The kit works offline and can be shared as plain text through the system share sheet.
- **Manual evacuation-zone verification:** Florida keeps the automatic state lookup. Everywhere else you can record the zone or area published by your local authority, add notes and a source URL, and see when the entry was verified. Zones older than 90 days are flagged for a recheck.
- **Optional local reminders:** off by default. Settings can schedule a weekly checklist nudge and a monthly zone recheck. These are best-effort local notifications, not weather alerts.
- **Versioned local storage:** all persisted state goes through `src/storage/store.ts`. Older 1.0 data is migrated on read; damaged documents are quarantined under a `.corrupt` key and a non-blocking banner explains what happened. Data written by a newer app version is never overwritten.

## Run in development

```sh
npm install
npx expo start
```

MapLibre includes native code, so use an Android development build (`npx expo run:android`) or an installed development client; Expo Go does not include the map module. Address search and new map downloads need an internet connection.

## Build an installable Android APK

This project includes an EAS `preview` profile configured to produce an APK (rather than an app bundle). After signing in to Expo, run:

```sh
npx eas-cli@latest login
npm run android:apk
```

EAS builds the APK in the cloud. When the build finishes, download the APK from the build page or CLI link and install it on an Android device. Cloud builds require an Expo account and network access. For a local Gradle build, install Android Studio and the Android SDK, then run `npx expo prebuild --platform android` and `npx expo run:android`.

## Quality checks

Run these before opening a pull request:

```sh
npx expo lint
npx tsc --noEmit
npm test
npm run test:coverage
npx expo-doctor
```

The Jest suite covers the kit calculator and formatting, StormReady 1.0 → plan schema v2 migration, storage migration/corruption/newer-version handling, manual zone validation and staleness, reminder scheduling, HTTP retries, offline routing/downloads with mocked fetch, the FEMA and Florida zone data sources, and the pure plan reducer. Component tests render the onboarding flow, the kit, the Home, Prepare, Settings, and Updates screens with React Native Testing Library. `fetch` is blocked globally in the Jest setup, so no test can reach the network.

`npm run test:coverage` enforces the coverage floor: at least 80 % statement coverage for `src/kit`, `src/storage`, and `src/zone`, and at least 60 % across `src/`. The two platform map screens are excluded from the coverage denominator because `map.native.tsx` needs the native MapLibre module and `map.web.tsx` needs react-native-web; neither can render in the Jest environment, so both are verified on a device instead.

GitHub Actions runs the same lint, typecheck, test, coverage, and Expo Doctor gates on pushes and pull requests.

Location, maps, file downloads, and notifications need a manual pass on a physical Android device. Emulators do not cover notification channels, background delivery, or map rendering well.

## Over-the-air updates

The app is configured for EAS Update with runtime version `1.1.0`. The `preview` and `production` EAS build profiles use matching update channels.

```sh
# Publish JavaScript/asset changes to the internal preview channel
npx eas-cli@latest update --channel preview --message "Describe the change"

# Publish to production after the matching build is installed
npx eas-cli@latest update --channel production --message "Describe the change"
```

OTA updates cannot add native modules or change native configuration. If you change native dependencies or permissions, create a new build and increment `runtimeVersion` (or switch to the app-version policy) so devices never receive an incompatible update.

## Scope and data freshness

Offline vector-map packs are limited to 3,000 tiles and 50 MB per map download. When an area is saved, the app also downloads a local road network used to calculate and guide routes entirely on-device. Offline routes work only inside that saved road area; address lookup needs a connection, but users can long-press the downloaded map or choose a saved shelter as an offline destination. Routes do not include live traffic, closures, or turn restrictions. Map data is © OpenStreetMap contributors and © OpenMapTiles. U.S. FEMA shelter listings and Mexico's community-mapped listings may be incomplete or stale; verify that a shelter is open and has space with local authorities before traveling. Automated evacuation-zone lookup is currently available only for Florida. Local emergency authorities issue current orders and determine zone information. Location is requested only after the user taps a location action. Saved area data is stored on-device.

Preparedness references: [FEMA](https://www.fema.gov/emergency-managers), [National Weather Service](https://www.weather.gov/), [Ready.gov](https://www.ready.gov/), [Mexico Protección Civil](https://www.gob.mx/proteccioncivil), [Mexico National Weather Service (SMN)](https://smn.conagua.gob.mx/es/), and [CENAPRED National Risk Atlas](https://www.atlasnacionalderiesgos.gob.mx/).
