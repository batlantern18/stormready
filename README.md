# StormReady v1.2

StormReady is a local-first preparedness app for households in the United States and Mexico. It helps people build and maintain an emergency plan, prepare supplies, coordinate with household members, and check official local guidance. Its Map screen supports shelter and evacuation-zone tools, offline map areas, and local route guidance. Personal plan data is stored on the device; StormReady does not require an account.

## What's new in v1.2

- **Track supplies:** record kit inventory, quantities, and expiration or rotation dates, then review gaps and items that need attention.
- **Build household go-bags:** organize grab-and-go supplies by person and track bag readiness.
- **Plan how to reconnect:** save household contacts, meeting locations, and check-in plans that can be shared without an account.
- **Practice before an emergency:** use offline scenario drills to find gaps and turn them into practical next steps.
- **See preparedness at a glance:** review a readiness summary and seasonal priorities without suggesting that conditions are safe.
- **Improve privacy controls:** review local data, transfer a household plan between devices, and clear saved data from the app.
- **Keep the map and location tools:** find shelters, verify evacuation zones, save an offline area, and use route guidance within its saved road coverage.
- **Keep v1.1 essentials:** the household-sized emergency kit, checklist, evacuation-zone verification, local reminders, weather guidance, and shelter information remain part of the app.

StormReady is a planning aid, not an emergency alert authority. Follow current directions from local emergency management and verify shelter availability before traveling. Availability of automated zone lookup and alert data depends on location and official data sources.

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

`npm run test:coverage` enforces the coverage floor: at least 80 % statement coverage for `src/kit`, `src/storage`, and `src/zone`, and at least 60 % across `src/`.

GitHub Actions runs the same lint, typecheck, test, coverage, and Expo Doctor gates on pushes and pull requests.

Location, maps, notifications, and file import/export need a manual pass on a physical device. Emulators do not fully cover notification channels, background delivery, map rendering, or platform file pickers.

## Over-the-air updates

The app uses EAS Update. The `preview` and `production` EAS build profiles use matching update channels; confirm the configured runtime version is compatible with the installed native build before publishing.

```sh
# Publish JavaScript/asset changes to the internal preview channel
npx eas-cli@latest update --channel preview --message "Describe the change"

# Publish to production after the matching build is installed
npx eas-cli@latest update --channel production --message "Describe the change"
```

OTA updates cannot add native modules or change native configuration. If you change native dependencies or permissions, create a new build and increment `runtimeVersion` (or switch to the app-version policy) so devices never receive an incompatible update.

## Scope and data freshness

Offline vector-map packs are limited to 3,000 tiles and 50 MB per map download. Offline routes work only inside the road area saved on the device; they do not include live traffic, closures, or turn restrictions. U.S. shelter information may come from FEMA; Mexico shelter listings may rely on community-mapped data. Verify that a shelter is open and has space with local authorities. Automated evacuation-zone lookup is currently available only for Florida; elsewhere, use the zone published by your local emergency authority. Local authorities issue current evacuation orders. Location is requested only after you choose a location-based action, and personal plan information remains on-device unless you explicitly share or export it.

Preparedness references: [FEMA](https://www.fema.gov/emergency-managers), [National Weather Service](https://www.weather.gov/), [Ready.gov](https://www.ready.gov/), [Mexico Protección Civil](https://www.gob.mx/proteccioncivil), [Mexico National Weather Service (SMN)](https://smn.conagua.gob.mx/es/), and [CENAPRED National Risk Atlas](https://www.atlasnacionalderiesgos.gob.mx/).
