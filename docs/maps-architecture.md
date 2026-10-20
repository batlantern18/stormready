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
src/app/(tabs)/map.native.tsx     ← THE map screen (native, ~910 lines)
src/app/(tabs)/map.web.tsx        ← web fallback (OSM iframe + Nominatim)
src/app/(tabs)/map.tsx            ← 3-line re-export so Expo Router has a generic sibling
src/offline-router.ts             ← Overpass downloads, offline search, A* routing, maneuvers
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
__tests__/offline-router.test.ts  ← routing/search unit tests (map screen itself untested)
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
   │  └─ BlurView glassPanel  → search field / saved-area header + status pill / errors
   ├─ View styles.mapControls (absolute right, top 38%)
   │  └─ follow-me button ("◎" following / "⌖" not following)
   └─ AnimatedBlurView styles.sheet (absolute bottom, Reanimated translateY)
      ├─ grip row (title, status pill, collapse toggle with accessibilityState.expanded)
      └─ ScrollView: selected-shelter card | zone result | shelter preview (3) |
         download progress bar | destination box + offline search results |
         offline guidance card | PDF + zone actions | attribution
├─ Modal (zoneOpen)  → Florida WebView lookup OR manual zone form
└─ Modal (sheltersOpen) → filterable full shelter directory with "Route" buttons
```

The blur is a two-part mechanism (expo-blur 58's target-based API): a `BlurTargetView` *wraps the map* and registers it as the blur source; the header and sheet are `BlurView`s pointed at that target via `blurTarget={blurTarget}` with `blurMethod="dimezisBlurViewSdk31Plus"` (an Android API 31+ implementation) and `intensity={70|78}`, tint following the theme:

```tsx
// map.native.tsx:627-657
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
// map.native.tsx:133-141
const settleSheet = (collapse: boolean) => {
  const target = collapse ? Math.max(0, sheetHeight.get() - 82) : 0;
  sheetTranslateY.set(reducedMotion ? target : withSpring(target, {
    duration: 300, dampingRatio: 0.8, reduceMotion: ReduceMotion.System,
  }));
  setContentsCollapsed(collapse);
};
```

**State** is all local `useState` inside the screen (~25 pieces: query, destination, route, pack, progress, following, current position, zone fields, selected shelter, modal flags…) plus four refs: `camera` (`CameraRef`), `fittedShelterArea` (dedupes shelter auto-fit), `packRef` (latest pack for concurrent async writes), `blurTarget`. There is no Redux/Zustand — global state is limited to the `PlanProvider` context (zone + destination text) and the theme context. Reanimated shared values: `sheetHeight`, `sheetTranslateY`, `reducedMotion`.

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

`saveArea(place)` (map.native.tsx:331) orchestrates:

1. Clears destination/current position, eases the camera to the place at zoom 12.5.
2. Creates a base `AreaPack` and persists it immediately (`persist` = set `packRef`, `setPack`, `save(keys.area, next)`).
3. Fires `startOfflinePack` (tiles) and `downloadRoadNetwork` concurrently; then awaits `Promise.allSettled([findNearbyShelters, downloadPdf (FL counties), lookupEvacuationZone (FL)])`.
4. Deliberately runs the destination-index Overpass call **after** the road-graph call — with the comment *"Keep the two larger Overpass requests sequential so a saved area download does not overwhelm the public service."*
5. Merges each fulfilled result into the pack; each rejection maps to a human-readable `setError(...)` (e.g. *"The map tiles were saved, but offline road data could not be downloaded."*).
6. Stamps `plan.setHousehold({ county })` so the Prepare tab knows the county.

**Concurrency safety:** `saveArea`, `startOfflinePack`, and `refreshOfflineData` overlap, so the pack id is reconciled by comparing `savedAt` snapshots before the final persist — `next.mapPackId = beforeDataSave.savedAt === base.savedAt ? beforeDataSave.mapPackId : null` — so a tile pack started by one task isn't clobbered by another task's stale copy of the pack.

**Persistence.** `src/storage/store.ts` provides versioned AsyncStorage load/save with a **250 ms debounce**, a per-key write queue, corruption quarantine, and `flushAll()` triggered when the app leaves the `active` AppState (registered in `src/app/_layout.tsx`). Keys (`src/storage/keys.ts`): `stormready.area.v3` (area pack) and `stormready.map-destination.v2` (last destination point). Large blobs never go in AsyncStorage — they're files under `Paths.document`:

- `stormready-roads-<lat>-<lon>.json` — road graph
- `stormready-search-<lat>-<lon>.json` — destination index
- `stormready-evac-<county>.pdf` — county evacuation map

On startup the screen re-verifies that each referenced file still exists and repairs the stored record if not (map.native.tsx:156-163), and it restores the offline-pack progress by asking `OfflineManager.getPack(saved.mapPackId).status()` — falling back to `state: 'missing'` if the pack is gone.

**Bounds.** All four downloads use the same computed bounds around the place — ±0.065° latitude with longitude padding scaled by `1 / max(0.45, cos(lat))` so the box stays roughly square in meters:

```ts
function mapBounds(place: Place): [number, number, number, number] {
  const latitudePad = 0.065;
  const longitudePad = latitudePad / Math.max(0.45, Math.cos(place.latitude * Math.PI / 180));
  return [place.longitude - longitudePad, place.latitude - latitudePad,
          place.longitude + longitudePad, place.latitude + latitudePad];
}
```

---

## 4. Offline map tiles (MapLibre offline packs)

**Conceptual idea:** once saved, the *visual* map must render with no connectivity. MapLibre's offline manager downloads every style resource and vector tile the region needs between two zoom levels, into a managed "pack". The app enforces a strict size budget, shows live progress in the sheet, and allows **only one area at a time** — completing a new download deletes all older packs.

**Technical details.** On mount the screen configures the offline manager and registers a request header so OpenFreeMap can identify the app:

```ts
// map.native.tsx:145-152
TransformRequestManager.addHeader({
  id: HEADER_ID, match: 'tiles\\.openfreemap\\.org',
  name: 'User-Agent', value: 'StormReady/1.1 (OpenFreeMap mobile map)',
});
OfflineManager.setTileCountLimit(MAX_TILES);      // 3000
OfflineManager.setProgressEventThrottle(700);
```

`startOfflinePack` (map.native.tsx:287) creates the pack with the light style, the area bounds, and `minZoom: 9, maxZoom: 15`, with metadata `{ name: 'StormReady <county>', app: 'StormReady' }`. Its `onProgress` callback:

- aborts and deletes the pack if `status.completedResourceSize > MAX_PACK_BYTES` (**50 MB**), setting `state: 'too-large'` and an error telling the user to pick a smaller area;
- otherwise mirrors progress into the `progress` state, which the sheet renders as a progress bar / status pill (`READY OFFLINE` / `<n>%` / `MAP NOT READY`);
- on `complete`, deletes every *other* existing pack (single-area policy).

An `onError` callback sets `state: 'error'`. The startup hydration effect restores progress for a previously saved pack id so an interrupted download isn't lost. Constants: `MAX_TILES = 3000`, `MAX_PACK_BYTES = 50 * 1024 * 1024`, progress throttle 700 ms.

---

## 5. Location: permissions, geocoding, live tracking

**Conceptual idea:** location permission is requested **only on an explicit user action** — never at startup, never during onboarding (spec rule R-ONB-4). A denied permission is never a hard block: every path degrades to a calm inline error message, and no code path deep-links to Settings.

**Technical details.** The `expo-location` config plugin in `app.json` carries a custom rationale string:

```json
["expo-location", { "locationWhenInUsePermission": "Use your location to find nearby shelters and check local weather alerts. Location stays on this device." }]
```

The Android manifest declares `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` (plus internet). There are five foreground-permission gates in the screen:

1. **`locateAddress(query)`** — geocode a typed address: `requestForegroundPermissionsAsync()` → `Location.geocodeAsync(value)` → `reverseGeocodeAsync` for the county/country → `supportedCountry(details)` which throws unless the ISO country is `US` or `MX`.
2. **`useCurrentLocation()`** — a one-shot `getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })`, reverse-geocoded into a `Place`, then `saveArea(...)` + `setCurrent(coords)`.
3. **`toggleFollowing()`** — flips the follow flag after a granted check.
4. **`startGuidance()`** and **`routeToEnteredDestination()`** — grab a fresh fix before computing an offline route (navigation must start from where you *actually* are, not the saved centroid).

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
// map.native.tsx:623
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

**Conceptual idea:** with no backend, the app carries its own tiny navigation stack. When an area is saved, it downloads the drivable road network and a place/address index for the bounds. Searching filters the index locally (fuzzy, accent-insensitive, abbreviation-expanding). Routing is A\* over a node graph built in memory from the saved ways, respecting one-ways and per-road-type speeds, then converted into turn instructions by comparing road names and bearings between consecutive edges. Guidance follows your GPS position along the route and detects going off-route.

**Technical details** (`src/offline-router.ts`, 289 lines):

**Downloads** — two Overpass queries (`https://overpass-api.de/api/interpreter`, POST, 120 s timeout, 1 retry, size-checked via `content-length` *and* re-serialized size):

- **Road graph** (`downloadOfflineRoadNetwork`): every `way` whose `highway` matches `ROUTABLE_HIGHWAYS` (motorway…residential, service, links; excludes `access`/`motor_vehicle` = no|private), with full geometry (`out body geom`). Each way becomes a `RoadWay { id, nodes, coordinates, name, highway, oneway }`; roundabouts default to oneway. Cap: **50 MB** (`MAX_NETWORK_BYTES`); a `remark` in the Overpass response (timeout/heap) is surfaced as an error.
- **Destination index** (`downloadOfflineDestinationIndex`): addresses (`addr:housenumber`), named roads, and named POIs (amenities, shops, tourism, leisure, places) with `out center`. Deduped into `OfflineDestination { id, name, address, city, region, latitude, longitude }`. Cap: **20 MB**.

**Offline search** (`searchOfflineDestinations`, top-6 default) normalizes text — NFD accent stripping, lowercasing, abbreviation expansion (`st`→street, `rd`→road, `ave`→avenue, `blvd`, `dr`, `ln`, `hwy`), punctuation collapsed to spaces — requires *every* query term to appear, then scores: exact match 0 / prefix 1 / contains 2, times 2, plus an "ordered terms" bonus; ties break alphabetically.

**Routing** (`routeOffline`):

1. Build a graph: for each way, connect consecutive node pairs; edge cost = haversine meters ÷ `roadSpeed(highway)` (m/s table: motorway 29 … service 6). One-way handling: forward edge unless `oneway === '-1'`; reverse edge unless `oneway` is `yes|1|true`. Out-of-bounds coordinates and zero-length segments are skipped.
2. Snap start and destination to the **nearest node within 1200 m** (`nearestNode`) — outside that, routing errors out with "outside the saved offline road area".
3. **A\*** with a hand-rolled binary `MinHeap`, heuristic = straight-line distance ÷ **35 m/s** (an optimistic speed, keeping the heuristic admissible since max edge speed is 29). A stale-queue skip (`if (next.priority > optimisticPriority + 1e-6) continue`) avoids re-expanding outdated pops. A **700,000-visit guard** aborts absurdly complex requests.
4. Reconstruct the path, build `RouteCoordinate[]` geometry, and derive **steps**: an initial "Head toward …", a maneuver whenever the road name changes or the bearing delta is ≥ 38°, and a final "Arrive at your destination". `maneuver()` classifies the turn angle (U-turn ≥ 150°, sharp ≥ 100°, normal ≥ 35°, else "Continue") and instructions append "onto <road name>". Per-step distances are summed from the edge lengths; `duration` sums `meters/speed`.
5. Result: `OfflineRoute { geometry: LineString, distance (m), duration (s), steps[] }` — drawn as the map's single polyline (see §8).

**Guidance & off-route detection** live in render-time derived values (map.native.tsx:497-508): `distanceToRouteMeters(current, line)` finds the closest route vertex and index; the current step is the last step whose `coordinateIndex ≤` that index; `offRoute` triggers when the perpendicular-ish distance exceeds **90 m**; `distanceToManeuver` sums haversine segments from the nearest vertex to the next step's coordinate.

**Destination resolution order** (`routeToEnteredDestination`): 1) exact-ish match against the saved shelter list; 2) offline index search — unique match routes immediately, multiple matches show a "choose below" list; 3) only then fall back to online `Location.geocodeAsync` (with the US/MX country check). `navigateTo()` persists the chosen point to `keys.destination` and fits the camera to the route bounds; on any routing error it still eases the camera to the destination so the user sees what they picked.

**Tests** (`__tests__/offline-router.test.ts`) cover the pure logic — search scoring, one-way handling, maneuver classification, off-route helpers — because `jest.setup.js` blocks all network (`globalThis.fetch` rejects). The map screen itself and MapLibre have no Jest mock, so the screen is untested.

---

## 8. Route rendering

The computed route is the only polyline on the map, drawn from the A\* output as a GeoJSON source + line layer colored from the active theme palette:

```tsx
// map.native.tsx:646-648
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

Endpoints used by the map:

| Endpoint | Consumer | Purpose |
|---|---|---|
| `tiles.openfreemap.org/styles/liberty` / `/dark` | map screen | vector styles (light/dark) |
| OpenFreeMap tile requests | `TransformRequestManager` header | UA identification |
| `overpass-api.de/api/interpreter` | offline-router, shelters (MX) | roads, destinations, MX shelters |
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
| nearest-node snap | ≤ 1200 m | `nearestNode` |
| A\* heuristic speed | 35 m/s; visit guard 700,000 | `routeOffline` |
| road speed table | motorway 29 m/s … service 6 m/s | `roadSpeed` |
| road graph / index caps | 50 MB / 20 MB | Overpass downloads |
| shelter radius | 50 km (50000 m) | FEMA/Overpass |
| offline search limit | 6 results | `searchOfflineDestinations` |
| zone staleness | 90 days | `zone/verification.ts` |
| sheet collapsed offset | 82 px | `settleSheet` |

**Known gaps / deliberate limitations**

- One saved area at a time (new pack completion deletes old packs); the app never downloads multiple regions.
- No marker clustering — up to ~1000 individual shelter markers may render at once.
- No map unit tests and no MapLibre Jest mock; only the pure routing/search/zone logic is covered by `__tests__/`.
- The notification deep-link route payload is written but no response listener consumes it.
- iOS support exists in configuration but is unverified (no iOS build artifacts in-repo).
- Web has no offline capability by design, and no routing at all.
