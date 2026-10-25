# How the Map Is Built

StormReady's **Map** tab is the center of the app's offline capability: it renders a vector map, downloads it (plus road/POI data) for offline use, finds shelters, computes turn-by-turn routes entirely on-device, and shows Florida evacuation-zone information. This document explains every part of it — conceptually first, with the technical details for each concept in the same section.

The app targets the **United States and Mexico** only; every geocoding path enforces this.

---

## 1. Big picture

The map is one Expo Router screen with two implementations, chosen at build time by file extension:

| Concern | Native (iOS/Android) | Web |
|---|---|---|
| Map renderer | **MapLibre React Native** (`@maplibre/maplibre-react-native` 11.3.4) — native GL renderer | `<iframe>` embed of OpenStreetMap |
| Tiles/styles | OpenFreeMap vector styles (`liberty` light / `dark`) | OSM raster tiles (dark mode = CSS filter) |
| Offline maps | MapLibre offline packs + local JSON road graph & search index | None (explicitly labeled "online only") |
| Routing | On-device A\* over a locally saved OSM road graph | None |
| Search | `expo-location` geocoding + on-device destination index | Nominatim HTTP search |

**Conceptual idea:** "save an area" means much more than caching tiles. When the user picks a home area, the app downloads *four independent artifacts* in parallel and stitches them into one persisted record (the "area pack"):

1. **Vector map tiles** for the area (MapLibre offline pack).
2. **A routable road graph** — every drivable way in the bounds, as a small JSON file.
3. **A destination search index** — addresses and named places in the bounds, as a small JSON file.
4. **Area intelligence** — nearby shelters (FEMA/OSM), and for Florida: the evacuation zone + the county evacuation PDF.

After that, routing, navigation guidance, shelter lookup, and destination search all work with **no network at all**.

### File map

```
src/app/(tabs)/map.native.tsx     ← THE map screen (native, ~1,090 lines)
src/app/(tabs)/map.web.tsx        ← web fallback (OSM iframe + Nominatim)
src/app/(tabs)/map.tsx            ← 3-line re-export so Expo Router has a generic sibling
src/offline-router.ts             ← Overpass downloads (mirrors, tiled), offline search, packed
                                     typed-array routing graph, A* + segment snapping, maneuvers
src/shelters.ts                   ← FEMA + Overpass shelter queries, haversine sort
src/zone.ts                       ← Florida evacuation-zone ArcGIS point-in-polygon lookup
src/zone/verification.ts          ← manual-zone validation, 90-day staleness, source links
src/area.ts                       ← core types: Place, AreaPack, MapDestination
src/net/http.ts                   ← httpFetch/httpJson: timeout, retry, User-Agent, errors
src/storage/keys.ts               ← storage keys (stormready.area.v3, stormready.map-destination.v2)
src/storage/store.ts              ← versioned AsyncStorage load/save, 250 ms debounce
src/plan.tsx / plan-schema.ts / plan-reducer.ts   ← PlanProvider context (zone + destination)
src/theme.ts                      ← light/dark palettes, ThemeProvider → picks map style URL
src/ui.tsx                        ← Page, Field, Action, Pill, Row shared components
src/app/(tabs)/_layout.tsx        ← tab registration ("Map", icon ⌖)
app.json                          ← config plugins: @maplibre/maplibre-react-native, expo-location
__tests__/offline-router.test.ts  ← search/scoring/maneuver unit tests
__tests__/offline-router-engine.test.ts ← routing engine: tolerant parsing, tiled/corridor merges,
                                     graph packing, snapping, one-ways, out-of-area errors
__tests__/offline-router-download.test.ts ← download engine: section splitting, partial results,
                                     cancellation, core/full road filters
__tests__/accessibility-roles.test.ts   ← scans src/ for RN-invalid accessibility roles (Android crash)
__tests__/zone.test.ts            ← zone validation tests
```

### Stack (from `package.json`)

- `@maplibre/maplibre-react-native` **11.3.4** — the map itself (not `react-native-maps`)
- `expo-location` ~58.0.18 — permissions, geocoding, live position
- `expo-blur` 58.0.5 — glass header/sheet over the map (`BlurTargetView`/`BlurView`)
- `expo-file-system` 58.0.9 — road graph, search index, evacuation PDFs
- `react-native-webview` 14.0.1 — official Florida zone-lookup web app in a modal
- `react-native-reanimated` 4.7.1 — bottom-sheet spring animation
- `@types/geojson` (dev) — types for the FEMA/GeoJSON route data

**Expo Go caveat:** MapLibre ships native code, so the map only appears in a **development build** (`npx expo run:android`, `eas build --profile development`) — not in Expo Go. The MapLibre config plugin is registered in `app.json` and writes Android Gradle properties (`org.maplibre.reactnative.*`). The repo uses Continuous Native Generation (no checked-in `ios/` folder; Android `AndroidManifest.xml` is checked in with location + internet permissions).

---

## 2. The screen: layout and composition

**Conceptual idea:** the map is full-bleed, and *everything else floats over it* as translucent glass — a search panel at the top, a context button on the right edge, and a collapsible "card" sheet at the bottom that shows whatever is currently relevant (a selected shelter, zone results, route guidance, download progress). Two full-screen modals handle the shelter directory and zone entry.

**Technical details.** `MapScreen()` in `map.native.tsx` renders inside `<Page scroll={false}>` (non-scrolling):

```
Page (scroll={false})
└─ View styles.screen
   ├─ BlurTargetView (ref=blurTarget) styles.absoluteMap   ← blur SOURCE: the map itself
   │  └─ NativeMap (absolute fill, mapStyle by theme)
   │     ├─ Camera (ref=camera)
   │     ├─ GeoJSONSource "destination-route" → Layer "destination-route-line"
   │     ├─ Marker "saved-place" / "current-location" / "offline-destination"
   │     └─ Marker × pack.shelters
   ├─ View styles.topWrap (absolute top)
   │  └─ BlurView glassPanel  → search field / saved-area header + status pill /
   │       area-download progress ("… N of M sections") / errors
   ├─ View styles.mapControls (absolute right, top 38%)
   │  └─ follow-me button ("◎" following / "⌖" not following)
   └─ AnimatedBlurView styles.sheet (absolute bottom, Reanimated translateY)
      ├─ grip row (title, status pill, collapse toggle with accessibilityState.expanded)
      └─ ScrollView: selected-shelter card | zone result | shelter preview (3) |
         download progress bar | destination box (with route progress) + offline
         search results | offline guidance card | PDF + zone actions | attribution
├─ Modal (zoneOpen)  → Florida WebView lookup OR manual zone form
└─ Modal (sheltersOpen) → filterable full shelter directory with "Route" buttons
```

The blur is a two-part mechanism (expo-blur 58's target-based API): a `BlurTargetView` *wraps the map* and registers it as the blur source; the header and sheet are `BlurView`s pointed at that target via `blurTarget={blurTarget}` with `blurMethod="dimezisBlurViewSdk31Plus"` (an Android API 31+ implementation) and `intensity={70|78}`, tint following the theme:

```tsx
// map.native.tsx:785-815
<BlurTargetView ref={blurTarget} style={styles.absoluteMap}>
  <NativeMap style={styles.absoluteMap} mapStyle={dark ? OPENFREE_DARK_STYLE : OPENFREE_STYLE} ...>
</BlurTargetView>
...
<BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={70}
          tint={dark ? 'dark' : 'light'} style={styles.glassPanel}>
```

The map itself carries positioned chrome:

```tsx
<NativeMap
  compass scaleBar attribution logo
  compassPosition={{ top: 220, right: 16 }}
  attributionPosition={{ bottom: 12, right: 12 }}
  logoPosition={{ bottom: 14, left: 12 }}
  onDidFinishLoadingMap={() => setMapReady(true)}
  onLongPress={...}>
```

The bottom sheet animates with Reanimated shared values and respects reduced motion — collapse translates the sheet up by its measured height minus 82 px with a spring, or jumps instantly when reduced motion is requested:

```tsx
// map.native.tsx:167-175
const settleSheet = (collapse: boolean) => {
  const target = collapse ? Math.max(0, sheetHeight.get() - 82) : 0;
  sheetTranslateY.set(reducedMotion ? target : withSpring(target, {
    duration: 300, dampingRatio: 0.8, reduceMotion: ReduceMotion.System,
  }));
  setContentsCollapsed(collapse);
};
```

**State** is all local `useState` inside the screen (~28 pieces: query, destination, route, pack, progress, `saveProgress`/`routeProgress` status lines, `roadCancelable`, following, current position, zone fields, selected shelter, modal flags…) plus seven refs: `camera` (`CameraRef`), `fittedShelterArea` (dedupes shelter auto-fit), `packRef` (latest pack for concurrent async writes), `packVersionRef` (only the newest offline-pack callbacks may update the screen), `graphRef` (the cached packed routing graph for the saved road file, so it is parsed at most once), `roadCancelRef` (the `AbortController` of the running road download, so the user can stop it), and `blurTarget`. There is no Redux/Zustand — global state is limited to the `PlanProvider` context (zone + destination text) and the theme context. Reanimated shared values: `sheetHeight`, `sheetTranslateY`, `reducedMotion`.

Two live status strings keep long operations honest instead of looking frozen: `saveProgress` ("Downloading offline road data… *n* of *m* sections") shows in the change-area form while an area saves, and `routeProgress` becomes the label of the "Go to destination" button while a route or a corridor download runs — both rendered as `accessibilityRole="text"` + `accessibilityLiveRegion="polite"` status text (see §14 for why that role choice matters on Android). While a road download runs, the bottom sheet also shows the progress with a **"Skip road data"** button, so a slow public service can never trap the user (§15).

**Styling/theming.** Two `StyleSheet.create` factories, `createStyles(colors, dark)`, produce `lightStyles`/`darkStyles`; the screen picks `const styles = dark ? darkStyles : lightStyles`. Key layout constants: `glassPanel` (radius 25, border, shadow, `elevation: 6`), `sheet` (absolute bottom 10, `maxHeight: '42%'`, `elevation: 8`), `mapControls` at `right: 14, top: '38%'`, 48×48 map buttons. The route line color comes straight from the palette (`colors.teal`).

---

## 3. Saving an area (the "area pack")

**Conceptual idea:** the user's saved place is the anchor for everything offline. Saving a place kicks off the tile download, road-graph download, search-index download, shelter lookup, and (for Florida) zone + PDF lookup *all at once*, then persists one combined record. Everything is best-effort: individual failures set a specific error message but never abort the rest.

**Technical details.** The domain type is the whole persisted record (`src/area.ts`):

```ts
export type Place = { label: string; latitude: number; longitude: number; county: string; region: string; countryCode: 'US' | 'MX' };
export type AreaPack = Place & {
  mapPackId: string | null;            // MapLibre offline pack id
  routingGraphUri?: string;            // local road-graph JSON
  destinationIndexUri?: string;        // local search index JSON
  shelters: Shelter[]; shelterCheckedAt: string | null;
  countyMapUri: string;                // local evacuation PDF
  evacuationZone?: EvacuationZone | null; zoneCheckedAt?: string | null; zoneLookupFailed?: boolean;
  savedAt: string;
};
export type MapDestination = { latitude: number; longitude: number };
```

`saveArea(place)` (map.native.tsx:411) orchestrates:

1. Clears destination/current position, eases the camera to the place at zoom 12.5.
2. Creates a base `AreaPack` and persists it immediately (`persist` = set `packRef`, `setPack`, `save(keys.area, next)`).
3. Fires `startOfflinePack` (tiles) and `downloadRoadNetwork` concurrently — the road download runs **tiled** (§7) and streams its progress into `saveProgress` ("Downloading offline road data… *n* of *m* sections"); it can be stopped by the user ("Skip road data"), which leaves the area saved without roads; then awaits `Promise.allSettled([findNearbyShelters, downloadPdf (FL counties), lookupEvacuationZone (FL)])`.
4. Deliberately runs the destination-index Overpass call **after** the road-graph call — with the comment *"Keep the two larger Overpass requests sequential so a saved area download does not overwhelm the public service."*
5. Merges each fulfilled result into the pack. **Every** failure is collected into one list and shown as a single message, with the road failure first — it is the one that disables offline routing, and it used to be overwritten by the later county/zone messages, so the user never learned the roads were missing. A road download that ended with missing sections is saved anyway and reported as incomplete. A failed refresh of the *same* area keeps the road file and address index that already work for it, instead of throwing them away.
6. Stamps `plan.setHousehold({ county })` so the Prepare tab knows the county.

**Concurrency safety:** `saveArea`, `startOfflinePack`, and `refreshOfflineData` overlap. The persistent map pack id is taken from the `startOfflinePack` result at the final persist (`next.mapPackId = mapResult.value.mapPackId`). Comparing `savedAt` snapshots is not enough: a mid-save persist can run before the pack exists and write `null`, and the final write used to preserve that `null`, so the app lost track of a completed pack and kept showing an older pack's progress.

**Persistence.** `src/storage/store.ts` provides versioned AsyncStorage load/save with a **250 ms debounce**, a per-key write queue, corruption quarantine, and `flushAll()` triggered when the app leaves the `active` AppState (registered in `src/app/_layout.tsx`). Keys (`src/storage/keys.ts`): `stormready.area.v3` (area pack) and `stormready.map-destination.v2` (last destination point). Large blobs never go in AsyncStorage — they're files under `Paths.document`:

- `stormready-roads-<lat>-<lon>.json` — road graph
- `stormready-search-<lat>-<lon>.json` — destination index
- `stormready-evac-<county>.pdf` — county evacuation map

On startup the screen re-verifies that each referenced file still exists and repairs the stored record if not (map.native.tsx:187-197). A dedicated effect polls `OfflineManager.getPack(saved.mapPackId).status()` every 2 s while the pack is active (and stops as soon as it is complete, missing, or has made no progress for 90 s). This is needed because MapLibre drops the **first** status update after an observer is attached: a pack that finishes during that gap never reports `complete`, which left the screen on "DOWNLOADING MAP 8%" even though every tile was saved. The saved road file is not read at startup: a `setTimeout(…, 600)` effect parses it once the map has drawn and warms the routing graph into `graphRef`, discarding the parsed network and keeping only the packed graph.

**Bounds.** Map tiles and road/address data use different bounds, because a tile pack is limited to 50 MB and 3,000 tiles while road data is only a JSON file:

- **Tiles** (`mapBounds`): ±0.065° latitude with longitude padding scaled by `1 / max(0.45, cos(lat))` so the box stays roughly square in meters.
- **Roads and addresses** (`routingAreaBounds`): ±0.035° latitude, the same cos-scaled longitude padding — roughly 4 km in every direction. This is the **core** of the saved area: small enough to download in a couple of requests and to keep in memory, and it covers the neighbourhood the user actually lives in. Longer trips download a corridor on demand (§7), and that corridor is merged into the saved area, so the saved area grows to cover the trips that were actually made.

```ts
function mapBounds(place: Place): [number, number, number, number] {
  const latitudePad = 0.065;
  const longitudePad = latitudePad / Math.max(0.45, Math.cos(place.latitude * Math.PI / 180));
  return [place.longitude - longitudePad, place.latitude - latitudePad,
          place.longitude + longitudePad, place.latitude + latitudePad];
}
```

**Trips that leave the saved area.** If the saved road network cannot reach a destination, the app downloads the road data for the trip's own bounding box (`corridorBounds`, ±0.03° around both points) while online, merges it into the saved network, and retries. The merged network is saved, so the same trip works offline afterwards. A corridor download always asks for the **full** road set (including service streets and alleys), so it also repairs a route that failed only because the saved area held the main roads but not the small local street the destination sits on.

---

## 4. Offline map tiles (MapLibre offline packs)

**Conceptual idea:** once saved, the *visual* map must render with no connectivity. MapLibre's offline manager downloads every style resource and vector tile the region needs between two zoom levels, into a managed "pack". The app enforces a strict size budget, shows live progress in the sheet, and allows **only one area at a time** — completing a new download deletes all older packs.

**Technical details.** On mount the screen configures the offline manager and registers a request header so OpenFreeMap can identify the app:

```ts
// map.native.tsx:179-185
TransformRequestManager.addHeader({
  id: HEADER_ID, match: 'tiles\\.openfreemap\\.org',
  name: 'User-Agent', value: 'StormReady/1.1 (OpenFreeMap mobile map)',
});
OfflineManager.setTileCountLimit(MAX_TILES);      // 3000
OfflineManager.setProgressEventThrottle(700);
```

`startOfflinePack` (map.native.tsx:380) creates the pack with the light style, the area bounds, and `minZoom: 9, maxZoom: 15`, with metadata `{ name: 'StormReady <county>', app: 'StormReady' }`. Its `onProgress` callback:

- aborts and deletes the pack if `status.completedResourceSize > MAX_PACK_BYTES` (**50 MB**), setting `state: 'too-large'` and an error telling the user to pick a smaller area;
- otherwise mirrors progress into the `progress` state, which the sheet renders as a progress bar / status pill (`READY OFFLINE` / `<n>%` / `MAP NOT READY`).

An `onError` callback sets `state: 'error'`. A separate effect polls the saved pack every 2 s while it is active, because MapLibre drops the first status update after the observer is attached and a pack can otherwise finish without ever reporting `complete`; the poll also marks a download `stalled` after 90 s with no new resource and pauses it. When the pack is complete, the poll deletes every other pack (single-area policy), so cleanup does not depend on that callback arriving. Constants: `MAX_TILES = 3000`, `MAX_PACK_BYTES = 50 * 1024 * 1024`, progress throttle 700 ms, poll 2 s, stall 90 s, watch cap 10 min.

---

## 5. Location: permissions, geocoding, live tracking

**Conceptual idea:** location permission is requested **only on an explicit user action** — never at startup, never during onboarding (spec rule R-ONB-4). A denied permission is never a hard block: every path degrades to a calm inline error message, and no code path deep-links to Settings.

**Technical details.** The `expo-location` config plugin in `app.json` carries a custom rationale string:

```json
["expo-location", { "locationWhenInUsePermission": "Use your location to find nearby shelters and check local weather alerts. Location stays on this device." }]
```

The Android manifest declares `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` (plus internet). There are five foreground-permission gates in the screen:

1. **`locateAddress(query)`** — geocode a typed address: `requestForegroundPermissionsAsync()` → `Location.geocodeAsync(value)` wrapped in a **20 s `withTimeout(...)`** (a slow or unreachable geocoder must not leave the screen stuck) → `reverseGeocodeAsync` for the county/country → `supportedCountry(details)` which throws unless the ISO country is `US` or `MX`.
2. **`useCurrentLocation()`** — a one-shot `getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })`, reverse-geocoded into a `Place`, then `saveArea(...)` + `setCurrent(coords)`.
3. **`toggleFollowing()`** — flips the follow flag after a granted check.
4. **`startGuidance()`** and **`routeToEnteredDestination()`** — grab a fresh fix before computing an offline route (navigation must start from where you *actually* are, not the saved centroid); the online-geocode fallback in the latter is also wrapped in the same 20 s timeout.

**Live tracking** (only while needed) uses a position watcher tuned for battery (Balanced accuracy, every 4 s or 12 m), stored into the `current` state, and cleaned up on unmount via an `active` flag + `subscription.remove()`:

```ts
Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 12 }, ...)
```

There is **no built-in location puck** — the app draws its own blue marker (below), and a follow effect eases the camera to the latest position whenever `following && current && mapReady`.

---

## 6. Markers, camera, and interaction

**Conceptual idea:** four kinds of dots — your saved place (teal), your live position (blue), your chosen destination (red), and shelters (amber) — all drawn as tiny custom React Native views rather than map images. There are no callouts: tapping a shelter opens the bottom-sheet card instead. The camera is never driven by region-change events; every move is an explicit, animated imperative call.

**Technical details.** One helper renders all marker kinds as plain views (a 24–29 px white-bordered circle with a 6 px white core and shadow):

```tsx
// map.native.tsx:781
const markerView = (kind: 'place' | 'shelter' | 'current' | 'destination') =>
  <View style={[styles.marker, /* kind-specific color */]}><View style={styles.markerCore} /></View>;
```

Rendered markers:

```tsx
{pack ? <Marker id="saved-place" lngLat={[pack.longitude, pack.latitude]}>{markerView('place')}</Marker> : null}
{current ? <Marker id="current-location" lngLat={[current.longitude, current.latitude]}>{markerView('current')}</Marker> : null}
{destinationPoint ? <Marker id="offline-destination" ...>{markerView('destination')}</Marker> : null}
{markers.map(shelter => <Marker key={shelter.id} id={shelter.id} lngLat={[shelter.longitude, shelter.latitude]}
    onPress={() => setSelectedShelter(shelter)}>{markerView('shelter')}</Marker>)}
```

Camera:

```tsx
<Camera ref={camera} initialViewState={{ center: initialCenter, zoom: pack ? 12.5 : 3.5 }} minZoom={3} maxZoom={18} />
// initialCenter = pack ? [pack.longitude, pack.latitude] : [-99, 29]   (Mexico-centered world view)
```

- `easeTo({ center, zoom, duration: 350–500, easing: 'ease' })` — save area, "Center map" button, shelter-row focus (zoom 14), route fallback.
- `fitBounds(bounds, { padding: { top: 150–170, right: 55, bottom: 330–350, left: 55 }, duration: 500–650 })` — fit all shelters, the route, or the guidance view. The paddings keep the route/shelters clear of the top glass panel and the bottom sheet.
- The shelter auto-fit is **deduped** with a key of `savedAt + shelter ids` in `fittedShelterArea`, and guards tiny bounding boxes by expanding any span under 0.04° by ±0.02° so a single shelter doesn't slam the camera to max zoom.

Map-level interaction is minimal: `onDidFinishLoadingMap` sets `mapReady` (gating camera moves), and **long-press** pins an offline destination at the pressed coordinate. There is no `onRegionChangeComplete` and no plain `onPress` on the map.

---

## 7. Offline search and routing (the on-device navigation engine)

**Conceptual idea:** with no backend, the app carries its own tiny navigation stack. When an area is saved, it downloads the drivable road network and a place/address index for the bounds. Searching filters the index locally (fuzzy, accent-insensitive, abbreviation-expanding). Routing is A\* over a graph built in memory from the saved ways — packed into flat typed arrays so it fits in a phone's memory — respecting one-ways and per-road-type speeds, with stops snapped onto road *segments* (not just to intersection nodes), then converted into turn instructions by grouping consecutive edges into legs of the same road. Guidance follows your GPS position along the route and detects going off-route.

**Technical details** (`src/offline-router.ts`, 981 lines):

**Downloads** — Overpass queries (POST, explicit `User-Agent`, per-attempt and whole-body time limits, hard byte cap):

- **Overpass mirrors.** `overpass.openstreetmap.fr` is first: it is the only public instance that reliably answers a small box in about a second. `overpass-api.de`, `lz4.overpass-api.de`, `overpass.kumi.systems`, `overpass.osm.jp`, `overpass.private.coffee`, and `maps.mail.ru` follow as fallbacks. A **shared `MirrorPool`** remembers which service answered during one area download: a mirror that fails is demoted, a successful one stays first, and every later tile or retry asks the healthy service first. The **intended first mirror is always kept in the candidate list**, though — otherwise one dropped connection to the only fast instance would push it out of the three mirrors a section tries and send every later request to services that never answer. Tiles are **not** rotated across mirrors — rotation was sending split sections to services that never answered, which is why dense areas ended up with partial roads and no address index.
- **A 200 with broken JSON means "too big".** Some mirrors cap a large chunked answer and simply stop mid-JSON while still returning 200. `httpJson` throws `HttpResponseTruncatedError`, and the tiled downloaders split the box instead of asking another mirror for the same oversized answer. A dropped connection (no HTTP status) is retried **once on the same mirror**; a timeout is not retried at the same size, because the box is the problem.
- **Tiled downloads that split instead of stalling.** A large area is split into 0.10° tiles (`tileBounds`) and fetched four at a time. Every tile has its own short time limit (20 s → 12 s → 10 s as the tile gets smaller). A tile that does not answer in time, is cut off, or cannot finish is **not retried at the same size**: it is split into four smaller tiles (`splitBounds`). A section that still fails at the smallest size is reported, and the roads that did arrive are kept — the download is marked `partial` and the screen says so. The whole run is bounded by a deadline (120 s), and an in-flight request is aborted when it expires, so the download can never hang.
- **Two road detail levels.** A saved area downloads the **core** roads only (motorway → residential): service roads, alleys and parking lanes are the bulk of a city's road data and are only needed to reach one address, so they are left out of the area download and fetched on demand for a specific trip (`detail: 'core' | 'full'`, `isDetailRoad`).
- **Cancellable.** Every request carries an `AbortSignal`. The user can stop a road download from the sheet ("Skip road data"); the area itself stays saved, the failure is reported as `RoadDownloadCancelledError`, and the roads can be downloaded later from the sheet ("Download offline road data").
- **Coordinates are rounded** to about 10 cm when parsed, which keeps the saved road file small enough to store and fast enough to load on a phone.
- **Road graph** (`downloadOfflineRoadNetwork`): every `way` whose `highway` matches the requested filter (motorway…residential, service, links; excludes `access`/`motor_vehicle` = no|private), with full geometry (`out body geom`). Each way becomes a `RoadWay { id, coordinates, name, highway, oneway }`; roundabouts default to oneway. Node ids are not stored — shared ways are joined by their rounded coordinates, which halves the file and most of the parse memory. Cap: **30 MB estimated** (`MAX_NETWORK_BYTES`).
- **Tolerant parsing** (`parseRoadWays`): Overpass can return a `null` where it could not resolve a node, and ways whose node list and geometry disagree. Such a way is dropped or trimmed instead of throwing — a single bad way used to abort the whole download, which left the app with no road data at all and made every route fail. Node ids stay aligned with the coordinates they belong to.
- **Destination index** (`downloadOfflineDestinationIndex`): addresses (`addr:housenumber`), named roads, and named POIs (amenities, shops, tourism, leisure, places) with `out center`. Deduped into `OfflineDestination { id, name, address, city, region, latitude, longitude }`. The saved core is requested as a **4×4 grid from the start** (16 sections, 4 in flight, 18 s per section, 120 s whole-run deadline) because one dense-city response is several megabytes and a mirror may cut it off. A section that is cut off or times out is split once more. When the first pass finishes, sections that were lost to a dropped connection are **retried as-is** (up to two passes, after a short pause) before the index is called partial. Results are merged and deduped; a section that still does not arrive marks the index `partial`, reports `missingSections` in saved-area sections, and the screen says so. `onProgress(completed, total)` feeds the "Saving offline addresses and places… n of 16 sections" line. Cap: **20 MB**.

**Offline search** (`searchOfflineDestinations`, top-6 default) normalizes text — NFD accent stripping, lowercasing, abbreviation expansion (`st`→street, `rd`→road, `ave`→avenue, `blvd`, `dr`, `ln`, `hwy`), punctuation collapsed to spaces — requires *every* query term to appear, then scores: exact match 0 / prefix 1 / contains 2, times 2, plus an "ordered terms" bonus; ties break alphabetically.

**Routing** (`routeWithGraph`; the older `routeOffline(network, start, destination)` remains as a convenience wrapper that builds a graph from a raw network and delegates):

1. Build a graph: for each way, connect consecutive node pairs; edge cost = haversine meters ÷ `roadSpeed(highway)` (m/s table: motorway 29 … service 6). One-way handling: forward edge unless `oneway === '-1'`; reverse edge unless `oneway` is `yes|1|true`. Out-of-bounds coordinates and zero-length segments are skipped. Each edge records its `highway` class and the node it comes from.
2. **Snap to the nearest road, not the nearest node.** A spatial grid (`EdgeGrid`, 0.01° cells) finds the closest *segment* and projects the point onto it, so a route starts and ends on the actual street rather than on a possibly distant intersection node. Stops farther than **400 m** from any road (`SNAP_MAX_METERS`) still raise the "outside the saved offline road area" error. Ramps (`motorway_link`, `trunk_link`, `primary_link`, `secondary_link`, `tertiary_link`) are never used to snap a stop — a ramp cannot be reached from an ordinary street.
3. **Reachability-aware destination snapping.** After the start is snapped, a forward breadth-first search marks every node reachable from it. The destination then snaps to the closest road that is actually reachable, so a destination sitting beside a motorway or a disconnected stretch of road still routes instead of failing.
4. **A\*** with a hand-rolled binary heap (`NodeHeap` over typed arrays), cost = travel time in seconds, and a heuristic of straight-line distance ÷ the **fastest speed present in the network**. The heuristic must be a strict lower bound: using a larger divisor (as an earlier version did) prunes the optimal path whenever a slow road is involved, which broke long trips. A **700,000-visit guard** aborts absurdly complex requests.
5. Virtual `__start__` / `__end__` nodes let the search begin and finish part-way along a segment, in whichever direction the one-way rules allow.
6. Reconstruct the path, build `RouteCoordinate[]` geometry, and derive **steps** by grouping edges into legs of the same road, then describing the change between consecutive legs: `Turn right onto Rämistrasse`, `Continue on Universitätstrasse`, `Turn left`, ending with `Arrive at your destination`. Per-step distances are summed from the edge lengths; `duration` sums `meters/speed`.
7. Result: `OfflineRoute { geometry: LineString, distance (m), duration (s), steps[] }` — drawn as the map's single polyline (see §8).

**Guidance & off-route detection** live in render-time derived values (map.native.tsx): `distanceToRouteMeters(current, line)` projects the driver onto the nearest route *segment* (not just the nearest vertex) to find the closest point and the distance off the line; the current step is the last step whose `coordinateIndex ≤` that index; `offRoute` triggers when the distance exceeds **90 m**; `distanceToManeuver` sums haversine segments from that point to the next step's coordinate, and `remainingRouteMeters` gives the distance still ahead. The guidance card shows the distance to the next turn in large type, the instruction, the following instruction ("Then …"), and the remaining distance and time.

**Keeping routing responsive without running out of memory.** A saved area is stored as coordinates only (no OSM node ids: ways that meet at a shared node have the same rounded coordinate, which is enough to join them). The routing graph is packed into flat typed arrays — `Float64Array` coordinates, `Int32Array` adjacency and edge endpoints, `Float32Array` lengths, `Uint8Array` speeds, and a `Map<number, Int32Array>` spatial grid — rather than one JS object per node and per edge. Measured on an 8×-area of real Zurich data (167k ways):

| | object graph | packed graph |
|---|---|---|
| saved file | 49.6 MB | 35.4 MB |
| heap after parsing | 189 MB | 130 MB |
| graph | 344 MB | 60 MB |
| peak (network + graph) | **533 MB** | **192 MB** |
| graph build | 1.7 s | 0.43 s |
| 13 km route (desktop) | 678 ms | 53 ms |

The object graph was over the per-app memory limit on Android, so the OS killed the app on the first route — the crash that the packed layout fixes. The parsed network is **not** retained once the graph is built; only the graph (about 25 MB for the default area) stays in memory.

- `prepareRoutingGraph(network, cacheKey)` builds and keeps the graph. The cache key combines the caller's cache key (the road file's URI) with a content fingerprint — FNV-1a over the network's `savedAt`, bounds, and every way id and name — so two different networks can never share a graph, and only the two most recent graphs are kept (`GRAPH_CACHE_LIMIT = 2`).
- `routeWithGraph(graph, start, destination)` runs A\* over the typed arrays with reused score/previous buffers and a typed-array heap. The expensive reachability BFS only runs if the closest road to the destination turns out to be unreachable.
- The saved area is `±0.09°` (about 10 km in every direction) and a merged corridor network is capped at an estimated 30 MB, so the graph stays well under the 2,000,000-edge hard ceiling.
- A road file larger than 40 MB, or one that fails to parse, is deleted and reported instead of being read — an oversized file would otherwise run the phone out of memory as soon as it was opened.
- When an area is saved, the graph is built in the background shortly afterwards, so the first route request is already warm.
- The screen yields for a frame before the search so "Finding route…" paints before the thread is blocked, and any online geocoding is wrapped in a 20 s timeout so a slow geocoder cannot leave the screen stuck.

**Destination resolution order** (`routeToEnteredDestination`): 1) exact-ish match against the saved shelter list; 2) offline index search — unique match routes immediately, multiple matches show a "choose below" list; 3) only then fall back to online `Location.geocodeAsync` (with the US/MX country check). `navigateTo()` persists the chosen point to `keys.destination` and fits the camera to the route bounds; on any routing error it still eases the camera to the destination so the user sees what they picked.

**Tests** — the map-related suites all run with `jest.setup.js` blocking network (`globalThis.fetch` rejects), so only pure logic is testable:

- `__tests__/offline-router.test.ts` — search scoring, one-way handling, maneuver classification, off-route helpers.
- `__tests__/offline-router-engine.test.ts` — the routing engine itself: tolerant Overpass parsing (`parseRoadWays` with null geometry), tile splitting (`tileBounds`), corridor merging (`corridorBounds`, `boundsInclude`, `mergeOfflineRoadNetworks`), graph packing (`prepareRoutingGraph`, `routingGraphKey`), snapping, one-way direction rules, and `RouteOutOfAreaError`.
- `__tests__/offline-router-download.test.ts` — the download engine: splitting a failed section into smaller ones, keeping partial results and flagging them, cancelling a download, the core/full road filters.
- `__tests__/accessibility-roles.test.ts` — scans `src/` for accessibility roles React Native doesn't implement (see §14).

The map screen itself and MapLibre have no Jest mock, so the screen is untested.

---

## 8. Route rendering

The computed route is the only polyline on the map, drawn from the A\* output as a GeoJSON source + line layer colored from the active theme palette:

```tsx
// map.native.tsx:804-806
{roadRoute ? <GeoJSONSource id="destination-route" data={roadRoute.geometry}>
  <Layer id="destination-route-line" type="line"
    layout={{ 'line-cap': 'round', 'line-join': 'round' }}
    paint={{ 'line-color': colors.teal, 'line-width': 5, 'line-opacity': 0.9 }} />
</GeoJSONSource> : null}
```

There is no clustering, no heatmap, and no polygon/fill/circle layers anywhere — shelters render as individual markers (bounded by the 50 km search radius), and the only other map-adjacent overlays are the county evacuation PDF (via `File.preview()`) and the Florida zone WebView modal.

---

## 9. Shelters

**Conceptual idea:** shelter data has two very different sources depending on country. In the US, an official FEMA service; in Mexico, community OpenStreetMap data. Both are queried within 50 km of the saved place, normalized into one `Shelter` shape, and sorted by haversine distance. The list is persisted in the area pack so it works offline; a refresh button re-fetches when connected.

**Technical details** (`src/shelters.ts`): `findNearbyShelters(place)` branches on `place.countryCode`:

- **US → FEMA National Shelter System** (`gis.fema.gov/.../FEMA_NSS/FeatureServer/0/query`): an ArcGIS point query with `geometry=<lon,lat>`, `distance: 50000` meters, `f: geojson`, `resultRecordCount: 1000`, paginated via `resultOffset` while `exceededTransferLimit` — so large metro areas return everything. Fields mapped: `shelter_name`, `address_1`, `city`, `org_main_phone`, `pet_accommodations_desc`, `wheelchair_accessible`.
- **MX → Overpass**: nodes/ways/relations tagged `emergency=shelter` or `amenity=shelter` within `around:50000`, `out center tags`; name falls back to `operator` or "Shelter listing", address assembled from `addr:*` tags.

Both paths compute `distance` with a haversine in miles (R = 3958.8) and sort ascending. Errors are translated ("The FEMA shelter directory is unavailable." / "Community shelter listings are unavailable."). The map sheet previews the nearest three under a "Nearby shelters" header (with a `SAVED OFFLINE` / `NOT SAVED` pill and a "See all *n*" row that opens the full, filterable directory modal — "…locations within 50 km · nearest first", with country-specific data-freshness disclaimers); a selected-shelter card in the sheet offers "Route to shelter offline", and directory rows ease the camera to zoom 14 and select the shelter.

---

## 10. Evacuation zones and county PDFs (Florida)

**Conceptual idea:** for Florida addresses the app adds storm-critical context: *which evacuation zone am I in*, and *here's the official county evacuation map*. The zone can come from an automatic point-in-polygon lookup against the state's official service, or be entered manually; either way it's stamped with a verification date, is flagged stale after 90 days, and links to official sources.

**Technical details:**

- **Automatic lookup** (`src/zone.ts`): ArcGIS point query against Florida Division of Emergency Management polygons (`FeatureServer/46/query`), `esriSpatialRelIntersects`, returning `EZone`, `County_Nam`, `STATUS` as `EvacuationZone { zone, county, status }` or `null` when no polygon contains the point. Runs during `saveArea` for Florida places and writes the result into both the area pack and the `PlanProvider` context (`source: 'florida-lookup'`).
- **Official lookup WebView** (`ZONE_LOOKUP` const, rendered in a `react-native-webview` modal) embed Florida's own lookup app for anything the API can't answer; non-Florida users instead get links to the Mexico risk atlas (`MEXICO_RISK_ATLAS`) and FEMA resources (`US_EMERGENCY_RESOURCES`) via `Linking.openURL`.
- **County PDF** (`countyPdfUrl`): `https://maps.floridadisaster.org/county/EVAC_<COUNTY>.pdf` (with a `MIAMI_DADE` slug special case), downloaded through `httpFetch` with a 60 s timeout and a content-type check, written to `Paths.document/stormready-evac-<county>.pdf`, then opened with `File.preview({ title })`. The stored URI is reused while the file exists.
- **Manual entry & freshness** (`src/zone/verification.ts`): `validateManualZone` normalizes/validates user input; `zoneSummary` and the `STALE_AFTER_DAYS = 90` constant drive the "re-check your zone" state; `OFFICIAL_ZONE_SOURCES` supplies provenance links. A failed automatic lookup sets `zoneLookupFailed` and points the user to the official lookup rather than showing a wrong answer.

---

## 11. Networking layer

Every HTTP call on the map goes through `src/net/http.ts` (`httpFetch` / `httpJson`), which provides: per-request timeouts, **exponential backoff retries** for GET/5xx/429, an explicit `User-Agent` per service ("StormReady/1.1 (…)" with a purpose suffix), and typed `HttpError` mapping. This is how the app stays polite to the free public services it depends on (OpenFreeMap, Overpass, Nominatim, FEMA/Esri).

**Response bodies are read as a stream, never as one buffer.** `httpFetch` resolves as soon as the headers arrive, so its timeout no longer covers the body. `httpJson` therefore reads the body in chunks (`readBodyText`) with a hard byte cap (`maxBytes`), its own timeout (`bodyTimeoutMs`) and an abort-aware reader. `response.json()` is only used when the runtime does not expose a stream.

This matters more than it looks: Overpass answers a large box with a chunked body and no `content-length`. `response.json()` buffered the whole thing into a Java `String` on the native heap, and a 128 MB allocation failed with `java.lang.OutOfMemoryError` inside `expo.modules.fetch` — which killed the app process outright, with no error the user could see. The streamed path cannot do that: it stops at the cap and reports "The service sent more data than this phone can keep. Try a smaller area."

Endpoints used by the map:

| Endpoint | Consumer | Purpose |
|---|---|---|
| `tiles.openfreemap.org/styles/liberty` / `/dark` | map screen | vector styles (light/dark) |
| OpenFreeMap tile requests | `TransformRequestManager` header | UA identification |
| Overpass interpreter (mirror list, §15) | offline-router, shelters (MX) | roads, destinations, MX shelters |
| `gis.fema.gov/.../FEMA_NSS/FeatureServer/0/query` | shelters (US) | official shelter directory |
| `services.arcgis.com/.../FeatureServer/46/query` | zone | Florida evacuation zones |
| `maps.floridadisaster.org/county/EVAC_*.pdf` | map screen | county evacuation maps |
| `floridadisaster.maps.arcgis.com/.../lookup` | WebView modal | official zone lookup UI |
| `nominatim.openstreetmap.org/search` | **web only** | address geocoding on web |

---

## 12. Navigation & routing integration (Expo Router)

The map is a tab: `src/app/(tabs)/_layout.tsx` registers `<Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: … '⌖' }} />`. Entry points:

- the Home tab shortcut (`/(tabs)/map` via `Link asChild`),
- the Prepare tab's "Review zone on Map" (`router.push('/(tabs)/map')`),
- the tab bar itself,
- a zone-recheck notification whose payload carries `data: { route: '/(tabs)/map' }` — note this is **payload only**; no notification-response listener navigates yet.

Leaving the map goes outward through `Linking.openURL` (official sources), `File.preview()` (PDF), and the two `Modal presentationStyle="pageSheet"` sheets. `app.json` enables `experiments.typedRoutes`, and the Android manifest registers the `stormready://` deep-link scheme.

---

## 13. Web fallback

**Conceptual idea:** the web build can't ship MapLibre native modules or offline packs, so it's a deliberate, honest degraded mode: an OpenStreetMap embed that pans to searched coordinates, with a note that offline maps live in the native app.

**Technical details** (`map.web.tsx`, ~200 lines): address search via Nominatim (`https://nominatim.openstreetmap.org/search`), country-checked to US/MX, then an `<iframe>` of the OSM embed centered on the result. Dark mode applies a CSS filter to the iframe:

```css
filter: dark ? 'invert(0.88) hue-rotate(180deg) brightness(0.86) contrast(0.92)' : 'none';
```

`map.tsx` exists solely because Expo Router requires a generic sibling next to platform-suffixed route files — it re-exports `./map.web`. `app.json` sets `extra.asyncRoutes.web: true`.

---

## 14. Platform notes, constants, and known gaps

**Platform specifics**

- The native/web split is at the route file level (`map.native.tsx` / `map.web.tsx`).
- The only `Platform` check in the map screen: modal `paddingTop` 14 (iOS) vs 8 (Android).
- The blur method `dimezisBlurViewSdk31Plus` is **Android API 31+** specific; the MapLibre config plugin writes Android Gradle properties. iOS is spec'd (no `ios/` folder — CNG generates it) but currently untested (spec R-IOS-3).
- Expo Go cannot load the map (native module) — a development build is required.
- **Only use React Native accessibility roles.** `accessibilityRole="status"` (an ARIA/web role that still
  type-checks because RN's type ends in `| string`) throws
  `java.lang.IllegalArgumentException: Invalid accessibility role value` inside Fabric's mount pass on
  Android. The exception kills the surface and the whole app turns blank/gray, with no JS error and no
  redbox in release. Use `accessibilityRole="text"` plus `accessibilityLiveRegion="polite"` for status
  messages. `__tests__/accessibility-roles.test.ts` scans `src/` and fails on any unsupported role.

**Key constants**

| Constant | Value | Where |
|---|---|---|
| `MAX_TILES` | 3000 | tile-count limit |
| `MAX_PACK_BYTES` | 50 MB | offline pack cap |
| offline pack zooms | 9–15 | `startOfflinePack` |
| map bounds pad | 0.065° lat, cos-scaled lon | `mapBounds` |
| camera | zoom 12.5 saved / 3.5 world, min 3, max 18 | `Camera` |
| fit paddings | top 150–170, sides 55, bottom 330–350 | `fitBounds` |
| location | Balanced, 4 s / 12 m | `watchPositionAsync` |
| off-route threshold | 90 m | guidance |
| stop → road snap | ≤ 400 m (`SNAP_MAX_METERS`), segment projection, ramps excluded | `nearestEdge` |
| A\* heuristic | straight-line ÷ fastest speed in network; visit guard 700,000 | `routeWithGraph` |
| routing area pad | 0.035° lat (~4 km core), cos-scaled lon | `routingAreaBounds` |
| corridor pad | 0.03° around trip points (`CORRIDOR_PAD_DEG`) | `corridorBounds` |
| download tiles | 0.10° (`TILE_DEGREES`), split into quarters on failure, 4 in parallel, 120 s deadline | `downloadOfflineRoadNetworkTiled` |
| tile time limits | 20 s → 12 s → 10 s per split level, 3 mirrors per section (`MIRRORS_PER_TILE`) | `TILE_TIMEOUTS_MS` |
| Overpass mirrors | 7 public instances, fastest first; overridable with `EXPO_PUBLIC_OVERPASS_MIRRORS` | `overpassMirrorUrls` |
| road body limit | 30 MB (`MAX_NETWORK_BYTES`), read as a stream | `httpJson`, `readBodyText` |
| destination index | 16 sections (4×4), 4 in flight, 18 s each, 120 s deadline, two lost-section retry passes, core roads only | `downloadOfflineDestinationIndex` |
| road detail | area save = core roads only; corridors = core + service streets | `highwayFilter`, `isDetailRoad` |
| road file refuse limit | 40 MB (`MAX_ROAD_FILE_BYTES`) | `loadRoutingGraph` |
| graph edge ceiling | 2,000,000 (`MAX_GRAPH_EDGES`); graph cache keeps 2 | `buildRoutingGraph` |
| online geocode timeout | 20 s | `withTimeout` |
| current-position timeout | 20 s | `withTimeout` |
| road speed table | motorway 29 m/s … service 6 m/s | `roadSpeed` |
| road graph / index caps | 30 MB / 20 MB | Overpass downloads |
| shelter radius | 50 km (50000 m) | FEMA/Overpass |
| offline search limit | 6 results | `searchOfflineDestinations` |
| zone staleness | 90 days | `zone/verification.ts` |
| sheet collapsed offset | 82 px | `settleSheet` |

**Known gaps / deliberate limitations**

- One saved area at a time (new pack completion deletes old packs); the app never downloads multiple regions.
- No marker clustering — up to ~1000 individual shelter markers may render at once.
- The map screen itself has no unit tests and no MapLibre Jest mock; the `__tests__/` suites (offline-router, offline-router-engine, offline-router-download, accessibility-roles, zone) cover the routing/search/download logic and accessibility roles around it.
- The notification deep-link route payload is written but no response listener consumes it.
- iOS support exists in configuration but is unverified (no iOS build artifacts in-repo).
- Web has no offline capability by design, and no routing at all.

---

## 15. The Road Data Download: What Was Broken and What Changed

**Symptom:** Saving an area got stuck on "Downloading offline road data… 4 of 30 sections", or appeared to take forever.

**Root cause:** the saved area was a rigid grid of 0.05° tiles (up to 30 of them for a ±0.09° box) and each tile request could spend up to 30 s *per mirror*, walking the whole mirror list. Four workers were therefore all sitting in slow retries at once, and the counter stopped moving. On top of that, every tile asked for the complete road set — including service roads and alleys, which are most of the payload in a city.

### What the download does now

1. **Fewer, bigger sections.** `TILE_DEGREES` is 0.10°, and the saved area itself is a small core (±0.035°, about 4 km) instead of ±0.09°. A typical area is now **one** request, not thirty.
2. **Sections are split when they are too big, not retried at the same size.** Each tile gets a short time limit (20 s → 12 s → 10 s as it gets smaller). A tile that does not answer in time or is cut off is replaced by four smaller tiles (`splitBounds`), because a smaller box is what a busy mirror can actually answer. A dropped connection is the exception: it gets one more try on the same mirror, because the same box usually answers. The section counter grows when a tile splits, so the number the user sees stays honest.
3. **The healthy mirror stays first.** A shared `MirrorPool` remembers which service answered during the download. Tiles are not rotated across mirrors any more: rotation sent split sections to services that never answered, which left dense cities with partial roads and no address index. The pool demotes a failing service and keeps the one that works first, but the intended first mirror is always included in the candidates — a single dropped connection must not push the only fast instance out of the three mirrors a section tries.
4. **Less data.** An area download asks for the **core** roads only (`highwayFilter('core')`: motorway → residential). Service streets and alleys are fetched on demand for a specific trip (`detail: 'full'`), which is also how a route that failed only because the destination sat on a small local street gets fixed.
5. **The user is never trapped.** Every request carries an `AbortSignal`, and the sheet shows a **"Skip road data"** button while a download runs. Skipping keeps the area (tiles, shelters, zone, evacuation PDF) and reports that the roads are missing; the sheet then offers **"Download offline road data"** to fetch them later. The whole run is bounded by a 120 s deadline that also aborts in-flight requests.
6. **Partial results are kept.** A section that never arrives is counted and reported ("*n* map sections could not be downloaded. Offline roads may be incomplete."), and the roads that did arrive are saved instead of being thrown away with the failed download.
7. **An empty section is not taken for the truth.** A mirror can answer with valid JSON and no roads for that box — that is what a mirror carrying only part of the world does. Such a section is asked once more on a different mirror before it is accepted as empty, so a partial mirror cannot silently punch a hole in the saved area.
8. **The road failure is reported first.** `saveArea` collects everything that went wrong into one message and puts the road failure at the front, because that is the one that disables offline routing. Previously a later "county evacuation map could not be downloaded" overwrote it, so the user never learned that the roads were missing.

### The mirror list

`overpassMirrorUrls()` is the list the app asks, in order:

| # | Mirror | Notes |
|---|---|---|
| 1 | `overpass.openstreetmap.fr` | community instance, world data, usually answers in about a second |
| 2 | `overpass-api.de` | the main instance, world data, but regularly needs tens of seconds for a small box |
| 3 | `lz4.overpass-api.de` | the main instance's load-balanced twin; currently does not answer in time |
| 4 | `overpass.kumi.systems` | world data |
| 5 | `overpass.osm.jp` | world data |
| 6 | `overpass.private.coffee` | world data |
| 7 | `maps.mail.ru/osm/tools/overpass/…` | world data; answers `504` when busy, which the app reports as "the service is busy" |

**Order matters.** The first mirror is the one most sections start with, so it has to be the one that answers fastest. `overpass-api.de` alone was the old list, and it needs ~40 s for a 0.07° box — longer than a section is allowed to take (20 s), so *every* section timed out and the area saved with no roads at all. With the fast instance first, the same area downloads in a couple of seconds.

The list can be replaced at build time with `EXPO_PUBLIC_OVERPASS_MIRRORS` (a comma-separated list of interpreter URLs), which is how the app is pointed at a self-hosted Overpass instance or a test service. An empty or invalid value keeps the public mirrors.

### The body limit

Overpass answers a large box with a chunked body and no `content-length`. `httpJson` reads that body in chunks with a hard cap, so a huge answer can no longer exhaust the native heap (see §11). A section larger than the cap is reported as "Road data for this area is larger than the phone can keep offline. Try a smaller nearby map area." and the area is still saved with its tiles.

### What this means in practice

| | before | now |
|---|---|---|
| sections for a saved area | up to 30 | 1 (split only if the service is busy) |
| time a stalled mirror can hold a worker | up to 2 minutes (30 s × 4 mirrors) | 20 s, then the tile is split |
| mirrors a single section tries | 1–3, and the last was unreachable code | 3, then the section is split across 4 more |
| area saved | ±0.09° (~10 km), all road types | ±0.035° (~4 km) core, main roads; corridors added on demand |
| user can stop the download | no | yes ("Skip road data") |
| one failed section | lost the whole download | reported; the rest is kept |
| one huge response | killed the app with an OOM | refused with a readable message |
| which failure the user sees | often the county PDF one | always the road one first |

### Checked on a device

The whole flow was run on an x86_64 Android emulator against the release build, saving the zip code **32502** (Pensacola, Florida):

- 99 map tiles, 1 shelter, evacuation zone D and the county PDF behaviour were all as expected;
- the road file was written to `/data/data/org.stormready.app/files/stormready-roads-30.409--87.225.json` (459 KB, 1602 real roads with street names), and the address index to `stormready-search-30.409--87.225.json` (332 KB, 2183 places);
- `stormready.area.v3` in AsyncStorage held both URIs plus the tile pack id;
- with the network switched off, a route to a saved address came back as "Offline road route · 1.0 mi · about 2 min";
- no `OutOfMemoryError` anywhere in logcat.

Two things could not be exercised there, both because of the emulator rather than the app: its GPS provider never delivers a fix (`last location=null`, 0 location reports), so the live guidance cannot start — the app now says "Your phone could not find your location. Turn on location services and try again." after 20 s instead of waiting for ever; and cleartext HTTP is blocked in release builds, so a local test service has to be HTTPS.

### A destination pinned on the map

A long press on the map sets a destination. Its coordinates are known at that moment, so the app keeps them (`pinnedDestination`) and "Go to destination" routes straight to the pin. Without that, the button looked the pin up as an address, which needs the network and therefore failed on every offline phone.