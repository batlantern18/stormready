import { BlurTargetView, BlurView } from 'expo-blur';
import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import { httpFetch } from '../../net/http';
import type { AreaPack, MapDestination, Place } from '../../area';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as NativeMap,
  Marker,
  OfflineManager,
  TransformRequestManager,
  type CameraRef,
  type OfflinePack,
  type OfflinePackStatus,
} from '@maplibre/maplibre-react-native';
import { RoadDownloadCancelledError, RouteOutOfAreaError, boundsInclude, corridorBounds, distanceAlongRouteMeters, distanceToRouteMeters, downloadOfflineDestinationIndex, downloadOfflineRoadNetworkTiled, isDetailRoad, mergeOfflineRoadNetworks, prepareRoutingGraph, routeWithGraph, searchOfflineDestinations, type OfflineDestinationIndex, type OfflineRoadNetwork, type OfflineRoute, type RoutePoint, type RoutingGraph } from '../../offline-router';
import { findNearbyShelters, type Shelter } from '../../shelters';
import React, { ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { WebView } from 'react-native-webview';
import { usePlan } from '../../plan';
import { keys } from '../../storage/keys';
import { load, save } from '../../storage/store';
import { OFFICIAL_ZONE_SOURCES, validateManualZone, zoneAgeText, zoneSummary } from '../../zone/verification';
import { lookupEvacuationZone } from '../../zone';
import { fetchOnlineDrivingRoute } from '../../online-router';
import { Action, Body, Field, MotionPressable as Pressable, Page, Pill, Row } from '../../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../../theme';

const OPENFREE_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const OPENFREE_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const ZONE_LOOKUP = 'https://floridadisaster.maps.arcgis.com/apps/instant/lookup/index.html?appid=aa18a2d8737c4d66bb6434a09e17203a';
const MEXICO_RISK_ATLAS = 'https://www.atlasnacionalderiesgos.gob.mx/';
const US_EMERGENCY_RESOURCES = 'https://www.fema.gov/emergency-managers';
const MAX_TILES = 3000;
const MAX_PACK_BYTES = 50 * 1024 * 1024;
/** The native progress callback can miss the final update, so the saved pack is
 * also read directly while it is active. */
const PACK_STATUS_POLL_MS = 2_000;
/** No new resource for this long means the pack download has stalled. */
const PACK_STALL_MS = 90_000;
/** Stop polling a status that never settles so the screen does not poll forever. */
const PACK_MAX_WATCH_MS = 10 * 60_000;
const HEADER_ID = 'stormready-openfreemap-user-agent';

type Progress = { percent: number; tiles: number; bytes: number; state: string };
type DestinationPoint = MapDestination;
type RoadRoute = OfflineRoute & { source: 'offline' | 'online' };

const distanceMiles = (a: number, b: number, c: number, d: number) => {
  const r = 3958.8, rad = (n: number) => n * Math.PI / 180;
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
function countyName(parts: Location.LocationGeocodedAddress[] = []) {
  const raw = parts[0]?.subregion || parts[0]?.district || '';
  return raw.replace(/\s+County$/i, '').trim();
}
function supportedCountry(address: Location.LocationGeocodedAddress | undefined): 'US' | 'MX' {
  const countryCode = address?.isoCountryCode?.trim().toUpperCase();
  if (countryCode === 'US' || countryCode === 'MX') return countryCode;
  throw new Error('StormReady currently supports addresses in the United States and Mexico. Include the country in your search.');
}
function isFlorida(place: Place) {
  return place.countryCode === 'US' && ['fl', 'florida'].includes(place.region.trim().toLowerCase());
}
function countyPdfUrl(county: string) {
  const normalized = county.trim().replace(/\s+County$/i, '');
  if (!normalized) return '';
  const slug = normalized.toLowerCase() === 'miami-dade' ? 'MIAMI_DADE' : normalized.toUpperCase();
  return `https://maps.floridadisaster.org/county/EVAC_${encodeURIComponent(slug)}.pdf`;
}
async function downloadPdf(url: string, filename: string) {
  let response: Response;
  try {
    response = await httpFetch(url, { timeoutMs: 60_000, userAgent: 'StormReady/1.1 (county evacuation map)' });
  } catch {
    throw new Error('County evacuation map is unavailable.');
  }
  if (!(response.headers.get('content-type') || '').toLowerCase().includes('pdf')) throw new Error('County evacuation map is unavailable.');
  const file = new File(Paths.document, filename);
  await file.write(new Uint8Array(await response.arrayBuffer()));
  return file.uri;
}
function mapBounds(place: Place): [number, number, number, number] {
  const latitudePad = 0.065;
  const longitudePad = latitudePad / Math.max(0.45, Math.cos(place.latitude * Math.PI / 180));
  return [place.longitude - longitudePad, place.latitude - latitudePad, place.longitude + longitudePad, place.latitude + latitudePad] as const;
}
// Road and address data can be larger than the downloaded map tiles without
// running into the tile pack limits. A saved area starts with a small core
// (about 4 km in every direction) so it is ready in seconds; trips that leave
// the core download their own road data on demand and merge it into the saved
// area, so the same trip works offline afterwards.
function routingAreaBounds(place: Place): [number, number, number, number] {
  const latitudePad = 0.035;
  const longitudePad = latitudePad / Math.max(0.45, Math.cos(place.latitude * Math.PI / 180));
  return [place.longitude - longitudePad, place.latitude - latitudePad, place.longitude + longitudePad, place.latitude + latitudePad] as const;
}
// Padding around a trip's start and destination when the saved road network
// cannot resolve it and road data must be fetched on demand.
const CORRIDOR_PAD_DEG = 0.03;
/** A saved road file larger than this cannot be read without running a phone
 * out of memory, so it is refused instead of crashing the app. */
const MAX_ROAD_FILE_BYTES = 40 * 1024 * 1024;
/** Fails a slow request instead of waiting forever, so the screen never hangs. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function downloadRoadNetwork(place: Place, onProgress?: (completed: number, total: number) => void, options: { signal?: AbortSignal } = {}) {
  // Downloaded in small tiles: one busy section can fail without losing the
  // rest, and a section that fails is split into smaller ones.
  const network = await downloadOfflineRoadNetworkTiled(routingAreaBounds(place), onProgress, { deadlineMs: 120_000, signal: options.signal, detail: 'core' });
  const file = new File(Paths.document, `stormready-roads-${place.latitude.toFixed(3)}-${place.longitude.toFixed(3)}.json`);
  await file.write(JSON.stringify(network));
  return { uri: file.uri, partial: Boolean(network.partial), missingSections: network.missingSections || 0 };
}

function hasCoords(point: { latitude?: unknown; longitude?: unknown } | null | undefined) {
  if (!point) return false;
  const valid = typeof point.latitude === 'number' && Number.isFinite(point.latitude) && typeof point.longitude === 'number' && Number.isFinite(point.longitude);
  if (!valid) console.warn('[stormready-map] dropped a marker with invalid coordinates:', JSON.stringify(point));
  return valid;
}
export default function MapScreen() {
  const plan = usePlan();
  const { profileId } = plan;
  const { dark, colors } = useAppTheme();
  const styles = dark ? darkStyles : lightStyles;
  const camera = useRef<CameraRef | null>(null);
  const fittedShelterArea = useRef<string | null>(null);
  const packRef = useRef<AreaPack | null>(null);
  // Lets only the newest offline-pack callbacks update the screen.
  const packVersionRef = useRef(0);
  // The packed routing graph for the saved area, kept so the road file is read
  // and parsed only once. Only the graph is retained, never the parsed network.
  const graphRef = useRef<{ uri: string; graph: RoutingGraph } | null>(null);
  // Lets the user stop a road data download instead of waiting for it.
  const roadCancelRef = useRef<AbortController | null>(null);
  const blurTarget = useRef<ComponentRef<typeof View> | null>(null);
  const sheetHeight = useSharedValue(0);
  const sheetTranslateY = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  // Android's Yoga lays a ScrollView out at its full content height whenever
  // the parent's height is only capped by a `maxHeight` (the sheet case): the
  // view is clipped on screen but believes it is fully visible, so it never
  // scrolls. Bounding the scroll view itself with measured numbers restores
  // scrolling; the sheet's own percentage cap stays in the styles.
  const [sheetAreaHeight, setSheetAreaHeight] = useState(0);
  const [sheetGripHeight, setSheetGripHeight] = useState(0);
  // 33 covers the sheet's vertical padding (10 top, 14 bottom) plus the 9 gap
  // between the grip row and the scroll area, matching the sheet styles.
  const sheetScrollMax = sheetAreaHeight && sheetGripHeight
    ? Math.max(140, sheetAreaHeight * 0.42 - 33 - sheetGripHeight)
    : undefined;
  const [query, setQuery] = useState('');
  const [destinationPoint, setDestinationPoint] = useState<DestinationPoint | null>(null);
  // A destination pinned on the map already has its coordinates. They are kept
  // so the route can be calculated without looking the place up again — which
  // would need the network and would fail while the phone is offline.
  const [pinnedDestination, setPinnedDestination] = useState<{ point: DestinationPoint; label: string } | null>(null);
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeProgress, setRouteProgress] = useState('');
  const [navigating, setNavigating] = useState(false);
  const [pack, setPack] = useState<AreaPack | null>(null);
  const [loadedDestinationIndex, setLoadedDestinationIndex] = useState<{ uri: string; index: OfflineDestinationIndex } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveProgress, setSaveProgress] = useState('');
  const [roadCancelable, setRoadCancelable] = useState(false);
  const [changeAreaOpen, setChangeAreaOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  const [current, setCurrent] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState('');
  const [zoneOpen, setZoneOpen] = useState(false);
  const [zone, setZone] = useState(plan.zone.value);
  const [zoneCounty, setZoneCounty] = useState(plan.zone.county);
  const [zoneNotes, setZoneNotes] = useState(plan.zone.notes);
  const [zoneSourceUrl, setZoneSourceUrl] = useState(plan.zone.sourceUrl);
  const [zoneError, setZoneError] = useState('');
  const [zoneSaved, setZoneSaved] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedShelter, setSelectedShelter] = useState<Shelter | null>(null);
  const [sheltersOpen, setSheltersOpen] = useState(false);
  const [shelterSearch, setShelterSearch] = useState('');
  const [sheltersRefreshing, setSheltersRefreshing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [contentsCollapsed, setContentsCollapsed] = useState(false);
  const destinationIndex = loadedDestinationIndex && pack?.destinationIndexUri === loadedDestinationIndex.uri ? loadedDestinationIndex.index : null;
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetTranslateY.get() }] }));
  const settleSheet = (collapse: boolean) => {
    const target = collapse ? Math.max(0, sheetHeight.get() - 82) : 0;
    sheetTranslateY.set(reducedMotion ? target : withSpring(target, {
      duration: 300,
      dampingRatio: 0.8,
      reduceMotion: ReduceMotion.System,
    }));
    setContentsCollapsed(collapse);
  };


  useEffect(() => {
    TransformRequestManager.addHeader({
      id: HEADER_ID,
      match: 'tiles\\.openfreemap\\.org',
      name: 'User-Agent',
      value: 'StormReady/1.1 (OpenFreeMap mobile map)',
    });
    OfflineManager.setTileCountLimit(MAX_TILES);
    OfflineManager.setProgressEventThrottle(700);
    load(keys.area).then(areas => {
      const parsed = areas[profileId];
      if (!parsed) return;
      const saved = { ...parsed, countryCode: parsed.countryCode || 'US', region: parsed.region || 'Florida', shelters: parsed.shelters || [] };
      if (saved.countyMapUri && !new File(saved.countyMapUri).exists) saved.countyMapUri = '';
      if (saved.routingGraphUri && !new File(saved.routingGraphUri).exists) saved.routingGraphUri = undefined;
      if (saved.destinationIndexUri && !new File(saved.destinationIndexUri).exists) saved.destinationIndexUri = undefined;
      packRef.current = saved;
      setPack(saved);
      if (saved.countyMapUri !== parsed.countyMapUri || saved.routingGraphUri !== parsed.routingGraphUri || saved.destinationIndexUri !== parsed.destinationIndexUri) {
        save(keys.area, { ...areas, [profileId]: saved });
      }
      // The pack status is polled by its own effect below, so a completed pack
      // whose final progress event was dropped still shows as ready.
    }).catch(() => setError('Your saved place could not be opened.'));
    load(keys.destination).then(destinations => {
      const point = destinations[profileId];
      if (point) setDestinationPoint(point);
    }).catch(() => {});
    return () => TransformRequestManager.removeHeader(HEADER_ID);
  }, [profileId]);

  useEffect(() => {
    let active = true;
    const uri = pack?.destinationIndexUri;
    if (!uri) return () => { active = false; };
    const file = new File(uri);
    if (!file.exists) return () => { active = false; };
    file.text().then(raw => {
      if (active) setLoadedDestinationIndex({ uri, index: JSON.parse(raw) as OfflineDestinationIndex });
    }).catch(() => {
      if (active) {
        setError('Saved offline destination search could not be opened. Download this area again while connected.');
      }
    });
    return () => { active = false; };
  }, [pack?.destinationIndexUri]);

  // Read the saved road network and build its routing graph ahead of time, so
  // the first route request does not have to do that work while the user waits.
  useEffect(() => {
    const uri = pack?.routingGraphUri;
    if (!uri) return;
    if (graphRef.current?.uri === uri) return;
    let cancelled = false;
    const file = new File(uri);
    if (!file.exists) return;
    // Same guard as the route path: never try to parse a file too large for the
    // phone to hold.
    if (file.size > MAX_ROAD_FILE_BYTES) return;
    // Let the map finish drawing before doing this heavy work.
    const timer = setTimeout(() => {
      file.text().then(raw => {
        if (cancelled) return;
        const network = JSON.parse(raw) as OfflineRoadNetwork;
        const graph = prepareRoutingGraph(network, uri);
        // Only the packed graph is kept: the parsed network is much larger and
        // is not needed once the graph exists.
        graphRef.current = { uri, graph };
      }).catch(() => { /* the route request will report the problem */ });
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pack?.routingGraphUri]);

  // MapLibre can drop the final progress callback. The first status update
  // after an observer is attached is ignored, and a pack that finishes during
  // that gap never reports "complete" — the screen then says "DOWNLOADING MAP
  // 8%" even though every tile is saved. Poll the saved pack directly while it
  // is active so the header always reflects the real state, and stop a download
  // that has made no progress at all instead of polling it forever.
  useEffect(() => {
    const mapPackId = pack?.mapPackId;
    if (!mapPackId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastKey = '';
    let lastChangeAt = Date.now();
    const startedAt = Date.now();
    const check = async () => {
      try {
        const offlinePack = await OfflineManager.getPack(mapPackId);
        if (cancelled) return;
        const status = await offlinePack.status();
        if (cancelled || !status) return;
        const key = `${status.state}:${status.completedResourceCount}:${status.completedTileCount}`;
        if (key !== lastKey) { lastKey = key; lastChangeAt = Date.now(); }
        setProgress({ percent: status.percentage, tiles: status.completedTileCount, bytes: status.completedResourceSize, state: status.state });
        if (status.state === 'complete') {
          setProgress({ percent: 100, tiles: status.completedTileCount, bytes: status.completedResourceSize, state: 'complete' });
          // Only one area is kept. Delete the other packs now, even if the
          // completion event never reached the JS callback.
          void OfflineManager.getPacks().then(packs => {
            // A new save may have started while the pack list was loading. Only
            // clean up if the completed pack is still the saved one; otherwise
            // the new pack could be deleted before its id is persisted.
            if (cancelled || packRef.current?.mapPackId !== mapPackId) return;
            for (const oldPack of packs) if (oldPack.id !== mapPackId) void OfflineManager.deletePack(oldPack.id).catch(() => {});
          }).catch(() => {});
          return;
        }
        if (status.state !== 'active') return;
        if (Date.now() - lastChangeAt > PACK_STALL_MS) {
          setProgress(current => ({ ...(current || { percent: 0, tiles: 0, bytes: 0 }), state: 'stalled' }));
          void offlinePack.pause().catch(() => {});
          return;
        }
        if (Date.now() - startedAt > PACK_MAX_WATCH_MS) {
          setProgress(current => ({ ...(current || { percent: 0, tiles: 0, bytes: 0 }), state: 'stalled' }));
          void offlinePack.pause().catch(() => {});
          return;
        }
        timer = setTimeout(() => void check(), PACK_STATUS_POLL_MS);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.message.includes('not found')) {
          setProgress({ percent: 0, tiles: 0, bytes: 0, state: 'missing' });
          return;
        }
        // A status read can fail while MapLibre is writing the pack. Try again
        // unless the watch has run for too long.
        if (Date.now() - startedAt < PACK_MAX_WATCH_MS) timer = setTimeout(() => void check(), PACK_STATUS_POLL_MS);
      }
    };
    void check();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [pack?.mapPackId]);

  const persist = useCallback(async (next: AreaPack) => {
    packRef.current = next;
    setPack(next);
    const areas = await load(keys.area);
    save(keys.area, { ...areas, [profileId]: next });
  }, [profileId]);

  const refreshOfflineData = useCallback(async () => {
    if (!pack || sheltersRefreshing) return;
    setSheltersRefreshing(true);
    try {
      const [shelterResult, zoneResult, pdfResult] = await Promise.allSettled([
        findNearbyShelters({ ...pack, countryCode: pack.countryCode || 'US' }),
        isFlorida(pack) ? lookupEvacuationZone(pack.latitude, pack.longitude) : Promise.resolve(null),
        isFlorida(pack) && pack.county ? downloadPdf(countyPdfUrl(pack.county), `stormready-evac-${pack.county.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`) : Promise.resolve(pack.countyMapUri),
      ]);
      const checkedAt = new Date().toISOString();
      const updated: AreaPack = { ...pack };
      if (shelterResult.status === 'fulfilled') {
        updated.shelters = shelterResult.value;
        updated.shelterCheckedAt = checkedAt;
      }
      if (zoneResult.status === 'fulfilled' && isFlorida(pack)) {
        updated.evacuationZone = zoneResult.value;
        updated.zoneCheckedAt = checkedAt;
        updated.zoneLookupFailed = false;
        setZone(zoneResult.value?.zone || '');
        plan.setZone({
          value: zoneResult.value?.zone || '',
          source: 'florida-lookup',
          county: zoneResult.value?.county || pack.county,
          verifiedAt: checkedAt,
          notes: zoneResult.value?.zone ? '' : 'No mapped zone was returned by the Florida lookup.',
          sourceUrl: ZONE_LOOKUP,
        });
      } else if (zoneResult.status === 'rejected') updated.zoneLookupFailed = true;
      if (pdfResult.status === 'fulfilled') updated.countyMapUri = pdfResult.value;
      await persist(updated);
      const failures = [shelterResult, zoneResult, pdfResult].filter(result => result.status === 'rejected').length;
      if (failures) setError(`${failures} offline item${failures === 1 ? '' : 's'} could not be refreshed. Previously saved copies are still available.`);
      else setError('Offline shelter, zone, and evacuation map data are up to date on this device.');
    } catch {
      setError('Offline data could not be refreshed. Previously saved copies remain on this device.');
    } finally {
      setSheltersRefreshing(false);
    }
  }, [pack, persist, plan, sheltersRefreshing]);

  const openZoneModal = useCallback(() => {
    setZone(plan.zone.value);
    setZoneCounty(plan.zone.county);
    setZoneNotes(plan.zone.notes);
    setZoneSourceUrl(plan.zone.sourceUrl);
    setZoneOpen(true);
  }, [plan.zone.value, plan.zone.county, plan.zone.notes, plan.zone.sourceUrl]);

  const openCountyMap = useCallback(async () => {
    if (!pack || !isFlorida(pack) || !pack.county) {
      openZoneModal();
      return;
    }
    setError('');
    setPdfLoading(true);
    try {
      let uri = pack.countyMapUri;
      if (!uri || !new File(uri).exists) {
        uri = await downloadPdf(
          countyPdfUrl(pack.county),
          `stormready-evac-${pack.county.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
        );
        await persist({ ...pack, countyMapUri: uri });
      }
      await new File(uri).preview({ title: `${pack.county} evacuation map` });
    } catch {
      setError(pack.countyMapUri
        ? 'The saved evacuation PDF could not be opened. Try downloading it again while connected.'
        : 'The evacuation PDF could not be saved. Connect to Wi-Fi or mobile data and try again.');
    } finally {
      setPdfLoading(false);
    }
  }, [pack, persist, openZoneModal]);

  const setDestination = useCallback(async (point: DestinationPoint | null) => {
    setDestinationPoint(point);
    const destinations = await load(keys.destination);
    if (point) save(keys.destination, { ...destinations, [profileId]: point });
    else {
      const next = { ...destinations };
      delete next[profileId];
      save(keys.destination, next);
    }
  }, [profileId]);

  const loadRoutingGraph = useCallback(async (): Promise<RoutingGraph> => {
    // The saved area is read from the ref, so a road file that was just
    // downloaded in this same request is found even before the screen
    // re-renders.
    const current = packRef.current || pack;
    if (!current?.routingGraphUri) throw new Error('This saved area has no offline road data. Download the area again while connected to prepare offline navigation.');
    if (graphRef.current?.uri === current.routingGraphUri) return graphRef.current.graph;
    const file = new File(current.routingGraphUri);
    if (!file.exists) throw new Error('Offline road data is missing. Download this map area again while connected.');
    // A road file written by an older, larger area can be big enough that
    // reading it would run the phone out of memory. Refuse it instead of
    // crashing, so the area can simply be saved again.
    if (file.size > MAX_ROAD_FILE_BYTES) {
      try { file.delete(); } catch { /* it will be replaced on the next save */ }
      throw new Error('The saved road data is too large for this phone. Save this map area again while connected to rebuild it.');
    }
    // The road file is large. It is parsed and packed into a graph once; only
    // the graph is kept, because the parsed network would double the memory.
    const raw = await file.text();
    let network: OfflineRoadNetwork;
    try {
      network = JSON.parse(raw) as OfflineRoadNetwork;
    } catch {
      try { file.delete(); } catch { /* it will be replaced on the next save */ }
      throw new Error('The saved road data is damaged. Save this map area again while connected to rebuild it.');
    }
    const graph = prepareRoutingGraph(network, current.routingGraphUri);
    graphRef.current = { uri: current.routingGraphUri, graph };
    return graph;
  }, [pack]);

  const startOfflinePack = useCallback(async (place: Place, area: AreaPack): Promise<{ mapPackId: string | null; error?: string }> => {
    setProgress({ percent: 0, tiles: 0, bytes: 0, state: 'active' });
    // A pack from the previous area may still emit progress while this one is
    // created. Only the newest pack is allowed to update the screen.
    const packVersion = ++packVersionRef.current;
    const isCurrentPack = () => packVersionRef.current === packVersion;
    let failure: string | undefined;
    let rejectedForSize = false;
    try {
      const onProgress = (offlinePack: OfflinePack, status: OfflinePackStatus) => {
        if (!isCurrentPack()) return;
        if (status.completedResourceSize > MAX_PACK_BYTES && !rejectedForSize) {
          rejectedForSize = true;
          failure = 'This area exceeded the 50 MB offline limit, so the download was stopped. Try a smaller nearby area.';
          void offlinePack.pause();
          void OfflineManager.deletePack(offlinePack.id);
          setProgress({ percent: status.percentage, tiles: status.completedTileCount, bytes: status.completedResourceSize, state: 'too-large' });
          return;
        }
        setProgress({ percent: status.percentage, tiles: status.completedTileCount, bytes: status.completedResourceSize, state: status.state });
        if (status.state === 'complete') {
          setProgress({ percent: 100, tiles: status.completedTileCount, bytes: status.completedResourceSize, state: 'complete' });
        }
      };
      const created = await OfflineManager.createPack({
        mapStyle: OPENFREE_STYLE,
        bounds: mapBounds(place),
        minZoom: 9,
        maxZoom: 15,
        metadata: { name: `StormReady ${place.county || place.label}`, app: 'StormReady' },
      }, onProgress, (_offlinePack, downloadError) => {
        if (!isCurrentPack()) return;
        setProgress(currentProgress => ({ ...(currentProgress || { percent: 0, tiles: 0, bytes: 0 }), state: 'error' }));
        failure = `Map download failed: ${downloadError.message}`;
        // May run after the save flow finished, so it still reports itself.
        setError(failure);
      });
      if (rejectedForSize) return { mapPackId: null, error: failure };
      const stored = packRef.current;
      const next = { ...(stored?.savedAt === area.savedAt ? stored : area), mapPackId: created.id };
      await persist(next);
      if (rejectedForSize) return { mapPackId: null, error: failure };
      // The pack id is now in state, so the status watcher below starts. It
      // polls the native pack directly; MapLibre drops the first progress event
      // after an observer is attached, and a pack that completes in that gap
      // never reports "complete" to the callback.
      return { mapPackId: created.id };
    } catch (e) {
      setProgress({ percent: 0, tiles: 0, bytes: 0, state: 'error' });
      return { mapPackId: null, error: e instanceof Error ? `Map download failed: ${e.message}` : 'Could not download the offline map.' };
    }
  }, [persist]);

  const saveArea = useCallback(async (place: Place) => {
    setBusy(true); setError(''); setCurrent(null); setSelectedShelter(null);
    // Captured before the new area replaces it, so a failed refresh can keep
    // road data that is already working for this same area.
    const previous = packRef.current;
    await setDestination(null);
    camera.current?.easeTo({ center: [place.longitude, place.latitude], zoom: 12.5, duration: 500, easing: 'ease' });
    const base: AreaPack = { ...place, mapPackId: null, shelters: [], shelterCheckedAt: null, countyMapUri: '', evacuationZone: null, zoneCheckedAt: null, zoneLookupFailed: false, savedAt: new Date().toISOString() };
    setPack(base);
    void persist(base);
    const mapTask = startOfflinePack(place, base);
    // The road download can be stopped by the user; the area itself is saved
    // either way and the roads can be downloaded later.
    const roadController = new AbortController();
    roadCancelRef.current = roadController;
    setRoadCancelable(true);
    const roadTask = downloadRoadNetwork(place, (completed, total) => {
      setSaveProgress(`Downloading offline road data… ${completed} of ${total} sections`);
    }, { signal: roadController.signal });
    const dataTasks = await Promise.allSettled([
      findNearbyShelters(place),
      isFlorida(place) && place.county ? downloadPdf(countyPdfUrl(place.county), `stormready-evac-${place.county.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`) : Promise.resolve(''),
      isFlorida(place) ? lookupEvacuationZone(place.latitude, place.longitude) : Promise.resolve(null),
    ]);
    // Keep the two larger Overpass requests sequential so a saved area download does not overwhelm the public service.
    const destinationIndexTask = roadTask.catch(() => '').then(() => {
      setSaveProgress('Saving offline addresses and places…');
      return downloadOfflineDestinationIndex(routingAreaBounds(place), {
        detail: 'core',
        onProgress: (completed, total) => setSaveProgress(`Saving offline addresses and places… ${completed} of ${total} sections`),
      });
    });
    const sameArea = Boolean(previous
      && previous.latitude.toFixed(3) === place.latitude.toFixed(3)
      && previous.longitude.toFixed(3) === place.longitude.toFixed(3));
    const previousRoadUri = sameArea && previous?.routingGraphUri && new File(previous.routingGraphUri).exists
      ? previous.routingGraphUri : undefined;
    const previousIndexUri = sameArea && previous?.destinationIndexUri && new File(previous.destinationIndexUri).exists
      ? previous.destinationIndexUri : undefined;
    let next = { ...base };
    const otherIssues: string[] = [];
    if (dataTasks[0].status === 'fulfilled') {
      next.shelters = dataTasks[0].value;
      next.shelterCheckedAt = new Date().toISOString();
    } else otherIssues.push('Nearby shelter locations could not be refreshed. Check your county’s current shelter information.');
    if (dataTasks[1].status === 'fulfilled') next.countyMapUri = dataTasks[1].value;
    else if (isFlorida(place) && place.county) otherIssues.push('The county evacuation map could not be downloaded.');
    if (dataTasks[2].status === 'fulfilled') {
      next.evacuationZone = dataTasks[2].value;
      next.zoneCheckedAt = new Date().toISOString();
      next.zoneLookupFailed = false;
      setZone(dataTasks[2].value?.zone || '');
      plan.setZone({
        value: dataTasks[2].value?.zone || '',
        source: 'florida-lookup',
        county: dataTasks[2].value?.county || place.county,
        verifiedAt: next.zoneCheckedAt,
        notes: dataTasks[2].value?.zone ? '' : 'No mapped zone was returned by the Florida lookup.',
        sourceUrl: ZONE_LOOKUP,
      });
    } else if (isFlorida(place)) {
      next.evacuationZone = null;
      next.zoneLookupFailed = true;
      otherIssues.push('The address was saved, but its evacuation zone could not be checked. Use the official zone lookup below.');
    } else { next.evacuationZone = null; next.zoneCheckedAt = null; next.zoneLookupFailed = false; }
    const beforeDataSave = packRef.current ?? base;
    next.mapPackId = beforeDataSave.savedAt === base.savedAt ? beforeDataSave.mapPackId : null;
    await persist(next);

    const [mapResult, roadResult, destinationIndexResult] = await Promise.allSettled([mapTask, roadTask, destinationIndexTask]);
    // The road failure goes first: it is the one that disables offline routing,
    // and it used to be hidden by the later county/address messages.
    const issues: string[] = [];
    if (roadResult.status === 'fulfilled') {
      next.routingGraphUri = roadResult.value.uri;
      if (roadResult.value.partial) {
        issues.push(`The area was saved, but ${roadResult.value.missingSections} map section${roadResult.value.missingSections === 1 ? '' : 's'} could not be downloaded. Offline roads may be incomplete.`);
      }
    } else if (roadResult.reason instanceof RoadDownloadCancelledError) {
      next.routingGraphUri = previousRoadUri;
      issues.push('The area was saved without offline road data. Download the road data again while connected to enable offline routing.');
    } else {
      next.routingGraphUri = previousRoadUri;
      const reason = roadResult.reason instanceof Error ? ` ${roadResult.reason.message}` : '';
      issues.push(`The map tiles were saved, but offline road data could not be downloaded.${reason}`);
    }
    if (mapResult.status === 'fulfilled') {
      // The pack task is the only writer that knows the real pack id. A
      // mid-save persist can run before the pack exists and store null, so the
      // final write must use the id that actually came back or the app loses
      // track of a completed download and keeps showing stale progress.
      next.mapPackId = mapResult.value.mapPackId;
      if (mapResult.value.error) issues.push(mapResult.value.error);
    } else {
      next.mapPackId = null;
      issues.push('The offline map tiles could not be downloaded.');
    }
    if (destinationIndexResult.status === 'fulfilled') {
      const indexFile = new File(Paths.document, `stormready-search-${place.latitude.toFixed(3)}-${place.longitude.toFixed(3)}.json`);
      try {
        await indexFile.write(JSON.stringify(destinationIndexResult.value));
        next.destinationIndexUri = indexFile.uri;
        if (destinationIndexResult.value.partial) {
          const missing = destinationIndexResult.value.missingSections || 0;
          issues.push(`The area was saved, but ${missing} address section${missing === 1 ? '' : 's'} could not be downloaded. Offline address search may be incomplete.`);
        }
      } catch {
        next.destinationIndexUri = previousIndexUri;
        issues.push('Offline addresses and places could not be saved to this device.');
      }
    } else {
      next.destinationIndexUri = previousIndexUri;
      const reason = destinationIndexResult.reason instanceof Error ? ` ${destinationIndexResult.reason.message}` : '';
      issues.push(`Offline addresses and place search could not be prepared.${reason}`);
    }
    issues.push(...otherIssues);
    plan.setHousehold({ county: [place.county, place.region].filter(Boolean).join(', ') || plan.household.county });
    const latest = packRef.current ?? next;
    if (latest.savedAt === base.savedAt && !next.destinationIndexUri) next.destinationIndexUri = latest.destinationIndexUri;
    await persist(next);
    setError(issues.join(' '));
    roadCancelRef.current = null;
    setRoadCancelable(false);
    setBusy(false);
    setSaveProgress('');
  }, [persist, plan, setDestination, startOfflinePack]);

  /** Stops the road data download. The area stays saved; the roads can be
   * downloaded again later while connected. */
  const skipRoadDownload = useCallback(() => {
    if (!roadCancelRef.current) return;
    roadCancelRef.current.abort();
    setSaveProgress('Skipping offline road data…');
  }, []);

  /** Downloads the road data for the saved area, for an area whose roads were
   * skipped or could not be fetched the first time. */
  const downloadRoadsForSavedArea = useCallback(async () => {
    if (!pack) return;
    setRouteLoading(true);
    setError('');
    setRouteProgress('Downloading offline road data…');
    const controller = new AbortController();
    roadCancelRef.current = controller;
    setRoadCancelable(true);
    try {
      const result = await downloadRoadNetwork(pack, (completed, total) => {
        setRouteProgress(`Downloading offline road data… ${completed} of ${total} sections`);
      }, { signal: controller.signal });
      const current = packRef.current ?? pack;
      await persist({ ...current, routingGraphUri: result.uri });
      setError(result.partial
        ? `The road data was saved, but ${result.missingSections} map section${result.missingSections === 1 ? '' : 's'} could not be downloaded. Offline roads may be incomplete.`
        : '');
    } catch (e) {
      setError(e instanceof RoadDownloadCancelledError
        ? 'The road data download was cancelled. The saved area is unchanged.'
        : e instanceof Error ? e.message : 'Offline road data could not be downloaded.');
    } finally {
      roadCancelRef.current = null;
      setRoadCancelable(false);
      setRouteLoading(false);
      setRouteProgress('');
    }
  }, [pack, persist]);

  const locateAddress = useCallback(async () => {
    if (busy) return;
    const value = query.trim();
    if (!value) { setError('Enter an address, city, or ZIP code first.'); return; }
    setBusy(true); setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Allow location access to look up a place and nearby shelters.');
      const results = await withTimeout(Location.geocodeAsync(value), 20_000, 'The address lookup took too long. Check your connection and try again.');
      if (!results.length) throw new Error('No location found. Try a more complete address, city, or postal code.');
      const first = results[0];
      const [details] = await Location.reverseGeocodeAsync({ latitude: first.latitude, longitude: first.longitude }).catch(() => []);
      const countryCode = supportedCountry(details);
      const county = countyName(details ? [details] : []);
      const region = details?.region || '';
      setBusy(false);
      await saveArea({ label: value, latitude: first.latitude, longitude: first.longitude, county, region, countryCode });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not find that address.'); setBusy(false); }
  }, [busy, query, saveArea]);

  const useCurrentLocation = useCallback(async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Allow location access to save the area around you.');
      // A phone that cannot get a fix would otherwise leave the screen waiting
      // for ever, with no way to tell what went wrong.
      const position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        20_000,
        'Your phone could not find your location. Turn on location services and try again.',
      );
      const [details] = await Location.reverseGeocodeAsync({ latitude: position.coords.latitude, longitude: position.coords.longitude }).catch(() => []);
      const countryCode = supportedCountry(details);
      const county = countyName(details ? [details] : []);
      const region = details?.region || '';
      const label = [details?.street, details?.city, details?.region].filter(Boolean).join(', ') || 'My current location';
      setBusy(false);
      await saveArea({ label, latitude: position.coords.latitude, longitude: position.coords.longitude, county, region, countryCode });
      setCurrent(position.coords);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not access your location.'); setBusy(false); }
  }, [busy, saveArea]);

  const toggleFollowing = useCallback(async () => {
    if (following) { setFollowing(false); setNavigating(false); return; }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) { setError('Allow location access to show and follow your position on the map.'); return; }
    setError(''); setFollowing(true);
  }, [following]);

  useEffect(() => {
    let subscription: Location.LocationSubscription | undefined;
    let active = true;
    if (following) {
      Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 12 }, position => {
        if (active) setCurrent(position.coords);
      }).then(value => { if (active) subscription = value; else value.remove(); }).catch(() => { setFollowing(false); setError('Live location is unavailable.'); });
    }
    return () => { active = false; subscription?.remove(); };
  }, [following]);

  useEffect(() => {
    if (following && current && mapReady) camera.current?.easeTo({ center: [current.longitude, current.latitude], duration: 450, easing: 'ease' });
  }, [current, following, mapReady]);

  useEffect(() => {
    if (!mapReady || !pack || (!pack.shelterCheckedAt && !pack.shelters?.length)) return;
    if (!pack.shelters?.length) return;
    const areaKey = `${pack.savedAt}:${pack.shelters.map(shelter => shelter.id).join(',')}`;
    if (fittedShelterArea.current === areaKey) return;
    fittedShelterArea.current = areaKey;
    const points = [
      [pack.longitude, pack.latitude] as const,
      ...pack.shelters.map(shelter => [shelter.longitude, shelter.latitude] as const),
    ];
    const bounds = points.reduce<[number, number, number, number]>(([west, south, east, north], [longitude, latitude]) => [
      Math.min(west, longitude), Math.min(south, latitude), Math.max(east, longitude), Math.max(north, latitude),
    ], [Infinity, Infinity, -Infinity, -Infinity]);
    // Keep a useful area visible when only the saved location is available.
    if (Math.abs(bounds[2] - bounds[0]) < 0.04) {
      bounds[0] -= 0.02;
      bounds[2] += 0.02;
    }
    if (Math.abs(bounds[3] - bounds[1]) < 0.04) {
      bounds[1] -= 0.02;
      bounds[3] += 0.02;
    }
    camera.current?.fitBounds(bounds, {
      padding: { top: 150, right: 55, bottom: 330, left: 55 },
      duration: 500,
      easing: 'ease',
    });
  }, [mapReady, pack]);

  const initialCenter: [number, number] = pack ? [pack.longitude, pack.latitude] : [-99, 29];
  const shelterStatus = progress?.state === 'complete' ? 'OFFLINE MAP READY' : progress?.state === 'active' ? 'DOWNLOADING MAP' : progress?.state === 'stalled' ? 'MAP NOT READY' : 'MAP AVAILABLE ONLINE';
  const nearestRoutePoint = current && roadRoute ? distanceToRouteMeters(current, roadRoute.geometry.coordinates) : null;
  let guidanceStep = 0;
  if (navigating && roadRoute && nearestRoutePoint) {
    for (let i = 1; i < roadRoute.steps.length; i++) {
      if (roadRoute.steps[i].coordinateIndex > nearestRoutePoint.index) break;
      guidanceStep = i;
    }
  }
  const offRoute = Boolean(navigating && nearestRoutePoint && nearestRoutePoint.distance > 90);
  const nextGuidance = roadRoute?.steps[guidanceStep];
  const nextManeuverIndex = roadRoute?.steps[guidanceStep + 1]?.coordinateIndex ?? (roadRoute?.geometry.coordinates.length || 1) - 1;
  const distanceToManeuver = nearestRoutePoint && roadRoute ? distanceAlongRouteMeters(roadRoute.geometry.coordinates, nearestRoutePoint.index, nextManeuverIndex) : nextGuidance?.distance || 0;
  // The instruction after the current one, shown as "Then …" like a real navigator.
  const followingStep = roadRoute?.steps[guidanceStep + 1] || null;
  // How much of the route is still ahead of the driver.
  const remainingRouteMeters = roadRoute && nearestRoutePoint
    ? distanceAlongRouteMeters(roadRoute.geometry.coordinates, nearestRoutePoint.index, roadRoute.geometry.coordinates.length - 1)
    : roadRoute?.distance || 0;
  const markers = useMemo(() => pack?.shelters || [], [pack?.shelters]);
  const currentZone = zoneSummary(plan.zone);
  const filteredShelters = useMemo(() => {
    const needle = shelterSearch.trim().toLocaleLowerCase();
    if (!needle) return markers;
    return markers.filter(item => `${item.name} ${item.address} ${item.city}`.toLocaleLowerCase().includes(needle));
  }, [markers, shelterSearch]);
  // When the saved road network cannot reach a destination, download the road
  // data for the trip's bounding box while online and store it with the saved
  // area so the same trip keeps working offline afterwards.
  const ensureRoadNetworkCovers = useCallback(async (origin: RoutePoint, destination: RoutePoint, graph: RoutingGraph | null) => {
    const basePack = packRef.current || pack;
    if (!basePack) return false;
    const corridor = corridorBounds(origin, destination, CORRIDOR_PAD_DEG);
    // The saved network is re-read only here, when it actually has to grow. It
    // is released again as soon as the new graph exists.
    let base: OfflineRoadNetwork = { version: 1, bounds: corridor, roads: [], savedAt: '' };
    const existing = basePack.routingGraphUri;
    if (existing) {
      const file = new File(existing);
      if (file.exists && file.size <= MAX_ROAD_FILE_BYTES) {
        try { base = JSON.parse(await file.text()) as OfflineRoadNetwork; } catch { /* start from the corridor */ }
      }
    }
    const covered = Boolean(graph && boundsInclude(graph.bounds, corridor));
    // A saved area starts with the main roads only. When a route fails even
    // though the area is covered, the small local roads are added once, because
    // a house can sit on a service street that was never downloaded.
    const hasDetail = base.roads.some(road => isDetailRoad(road.highway));
    if (covered && hasDetail) return false;
    // Tiled so a long trip does not need one enormous request.
    setRouteProgress('Downloading road data…');
    const extra = await downloadOfflineRoadNetworkTiled(corridor, (completed, total) => {
      setRouteProgress(`Downloading road data… ${completed} of ${total} sections`);
    }, { detail: 'full', deadlineMs: 120_000 });
    setRouteProgress('');
    const merged = mergeOfflineRoadNetworks(base, extra);
    const uri = existing || new File(Paths.document, `stormready-roads-${basePack.latitude.toFixed(3)}-${basePack.longitude.toFixed(3)}.json`).uri;
    await new File(uri).write(JSON.stringify(merged));
    // The saved network changed, so the cached graph is replaced.
    graphRef.current = { uri, graph: prepareRoutingGraph(merged, uri) };
    await persist({ ...basePack, routingGraphUri: uri });
    return true;
  }, [pack, persist]);

  const calculateRoute = useCallback(async (origin: RoutePoint, destination: RoutePoint): Promise<RoadRoute> => {
    let graph: RoutingGraph | null = null;
    try { graph = await loadRoutingGraph(); } catch { graph = null; }
    // If this trip is outside the saved road graph, try a live route first.
    // That avoids making people wait through a large Overpass download just to
    // get directions. A successful result is clearly marked as online below.
    let onlineError: unknown;
    const onlineRoute = async () => ({ ...await fetchOnlineDrivingRoute(origin, destination), source: 'online' as const });
    if (!graph) {
      try { return await onlineRoute(); } catch (error) { onlineError = error; }
      // No road data saved yet: fetch it for the trip straight away.
      try {
        await ensureRoadNetworkCovers(origin, destination, null);
        graph = await loadRoutingGraph();
      } catch {
        if (onlineError instanceof Error) throw new Error(`${onlineError.message} Road data for this trip could not be downloaded either.`);
        throw new Error('Road data for this trip is not on this device yet. Connect to the internet and try again to download it.');
      }
    }
    let route: RoadRoute;
    try {
      // Let the screen show "Finding route…" before the search blocks the
      // thread, so the app never looks frozen.
      await new Promise(resolve => setTimeout(resolve, 30));
      // The packed graph is reused, so a route never rebuilds it.
      route = { ...routeWithGraph(graph, origin, destination), source: 'offline' };
    } catch (routeError) {
      if (!(routeError instanceof RouteOutOfAreaError)) throw routeError;
      try { return await onlineRoute(); } catch (error) { onlineError = error; }
      let extended: boolean;
      try {
        extended = await ensureRoadNetworkCovers(origin, destination, graph);
      } catch {
        if (onlineError instanceof Error) throw new Error(`${onlineError.message} Road data for the trip could not be downloaded right now. Check your connection and try again.`);
        throw new Error(`${routeError.message} Road data for the trip could not be downloaded right now. Check your connection and try again.`);
      }
      if (!extended) throw routeError;
      const updated = await loadRoutingGraph();
      route = { ...routeWithGraph(updated, origin, destination), source: 'offline' };
    }
    return route;
  }, [ensureRoadNetworkCovers, loadRoutingGraph]);

  const navigateTo = useCallback(async (point: DestinationPoint, label: string) => {
    if (!pack) { setError('Save a map area in the United States or Mexico before choosing a destination.'); return; }
    setRouteLoading(true);
    setError('');
    setSelectedShelter(null);
    setContentsCollapsed(false);
    setRoadRoute(null);
    setNavigating(false);
    plan.setDestination({ address: label });
    await setDestination(point);
    const origin = current || { latitude: pack.latitude, longitude: pack.longitude };
    try {
      const route = await calculateRoute(origin, point);
      setRoadRoute(route);
      const bounds = route.geometry.coordinates.reduce<[number, number, number, number]>(([west, south, east, north], [longitude, latitude]) => [
        Math.min(west, longitude), Math.min(south, latitude), Math.max(east, longitude), Math.max(north, latitude),
      ], [Infinity, Infinity, -Infinity, -Infinity]);
      camera.current?.fitBounds(
        bounds,
        { padding: { top: 150, right: 55, bottom: 350, left: 55 }, duration: 650, easing: 'ease' },
      );
    } catch (e) {
      camera.current?.easeTo({ center: [point.longitude, point.latitude], zoom: 14, duration: 450, easing: 'ease' });
      setError(e instanceof Error ? e.message : 'Could not calculate an offline route.');
    } finally {
      setRouteLoading(false);
      setRouteProgress('');
    }
  }, [calculateRoute, current, pack, plan, setDestination]);

  const startGuidance = useCallback(async () => {
    if (!destinationPoint || !roadRoute) { setError('Choose a destination and calculate its offline route first.'); return; }
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Allow location access to follow your progress along the offline route.');
      // A phone without a fix must not leave the guidance waiting for ever.
      const position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        20_000,
        'Your phone could not find your location. Turn on location services and try again.',
      );
      const origin = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      const route = await calculateRoute(origin, destinationPoint);
      setCurrent(origin); setRoadRoute(route);
      setNavigating(true); setFollowing(true);
      camera.current?.fitBounds(
        route.geometry.coordinates.reduce<[number, number, number, number]>(([west, south, east, north], [longitude, latitude]) => [
          Math.min(west, longitude), Math.min(south, latitude), Math.max(east, longitude), Math.max(north, latitude),
        ], [Infinity, Infinity, -Infinity, -Infinity]),
        { padding: { top: 170, right: 55, bottom: 350, left: 55 }, duration: 500, easing: 'ease' },
      );
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start offline navigation.'); }
  }, [calculateRoute, destinationPoint, roadRoute]);

  const routeToEnteredDestination = useCallback(async () => {
    const address = plan.destination.address.trim();
    if (!address) { setError('Enter a destination address or choose a nearby shelter.'); return; }
    // A spot pinned on the map already knows where it is. Looking it up again
    // would need the network, so the route is calculated straight from the pin.
    if (pinnedDestination && pinnedDestination.label === address) {
      await navigateTo(pinnedDestination.point, pinnedDestination.label);
      return;
    }
    const match = markers.find(item => `${item.name} ${item.address} ${item.city}`.toLocaleLowerCase().includes(address.toLocaleLowerCase()));
    if (match) { await navigateTo(match, match.name); return; }
    const savedMatches = destinationIndex ? searchOfflineDestinations(destinationIndex, address) : [];
    if (savedMatches.length === 1) {
      const saved = savedMatches[0];
      await navigateTo({ latitude: saved.latitude, longitude: saved.longitude }, saved.name);
      return;
    }
    if (savedMatches.length > 1) {
      setError('Choose a matching saved address or place below, or enter a more specific destination.');
      return;
    }
    setRouteLoading(true);
    setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Allow location access to find this destination.');
      // Geocoding needs the network. Without a time limit a slow or unreachable
      // geocoder leaves the screen stuck on "Finding route…".
      const results = await withTimeout(Location.geocodeAsync(address), 20_000, 'The address lookup took too long. Check your connection and try again.');
      if (!results.length) throw new Error('No destination found. Try a complete U.S. or Mexico address.');
      const point = results[0];
      const [details] = await Location.reverseGeocodeAsync({ latitude: point.latitude, longitude: point.longitude }).catch(() => []);
      supportedCountry(details);
      await navigateTo({ latitude: point.latitude, longitude: point.longitude }, address);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not find that destination.');
      setRouteLoading(false);
      setRouteProgress('');
    }
  }, [destinationIndex, markers, navigateTo, pinnedDestination, plan.destination.address]);

  const destinationSearchResults = useMemo(() => destinationIndex
    ? searchOfflineDestinations(destinationIndex, plan.destination.address)
    : [], [destinationIndex, plan.destination.address]);
  const saveManualZone = useCallback(() => {
    const result = validateManualZone({
      value: zone,
      county: zoneCounty,
      verifiedAt: new Date().toISOString(),
      notes: zoneNotes,
      sourceUrl: zoneSourceUrl,
    });
    if (!result.valid || !result.value) {
      setZoneError(Object.values(result.errors).find(Boolean) || 'Check the zone details and try again.');
      return;
    }
    plan.setZone(result.value);
    setZoneError('');
    setZoneSaved(true);
  }, [plan, zone, zoneCounty, zoneNotes, zoneSourceUrl]);
  const destinationMatch = useMemo(() => {
    const needle = plan.destination.address.trim().toLocaleLowerCase();
    if (!needle) return null;
    return markers.find(item => `${item.name} ${item.address} ${item.city}`.toLocaleLowerCase().includes(needle)) || null;
  }, [markers, plan.destination.address]);
  const markerView = (kind: 'place' | 'shelter' | 'current' | 'destination') => <View style={[styles.marker, kind === 'place' ? styles.placeMarker : kind === 'current' ? styles.currentMarker : kind === 'destination' ? styles.destinationMarker : styles.shelterMarker]}><View style={styles.markerCore} /></View>;

  return <Page scroll={false}>
    <View style={styles.screen} onLayout={event => setSheetAreaHeight(event.nativeEvent.layout.height)}>
      <BlurTargetView ref={blurTarget} style={styles.absoluteMap}>
        <NativeMap
          style={styles.absoluteMap}
          mapStyle={dark ? OPENFREE_DARK_STYLE : OPENFREE_STYLE}
          compass
          scaleBar
          attribution
          logo
          compassPosition={{ top: 220, right: 16 }}
          attributionPosition={{ bottom: 12, right: 12 }}
          logoPosition={{ bottom: 14, left: 12 }}
          onDidFinishLoadingMap={() => setMapReady(true)}
          onLongPress={event => {
            if (!pack) return;
            const [longitude, latitude] = event.nativeEvent.lngLat;
            const point = { latitude, longitude };
            setPinnedDestination({ point, label: 'Pinned map destination' });
            void navigateTo(point, 'Pinned map destination');
          }}
        >
          <Camera ref={camera} initialViewState={{ center: initialCenter, zoom: pack ? 12.5 : 3.5 }} minZoom={3} maxZoom={18} />
          {roadRoute ? <GeoJSONSource id="destination-route" data={roadRoute.geometry}>
            <Layer id="destination-route-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.teal, 'line-width': 5, 'line-opacity': 0.9 }} />
          </GeoJSONSource> : null}
          {pack && hasCoords(pack) ? <Marker id="saved-place" lngLat={[pack.longitude, pack.latitude]}>{markerView('place')}</Marker> : null}
          {current && hasCoords(current) ? <Marker id="current-location" lngLat={[current.longitude, current.latitude]}>{markerView('current')}</Marker> : null}
          {destinationPoint && hasCoords(destinationPoint) ? <Marker id="offline-destination" lngLat={[destinationPoint.longitude, destinationPoint.latitude]}>{markerView('destination')}</Marker> : null}
          {markers.filter(hasCoords).map(shelter => <Marker key={shelter.id} id={shelter.id} lngLat={[shelter.longitude, shelter.latitude]} onPress={() => setSelectedShelter(shelter)}>{markerView('shelter')}</Marker>)}
        </NativeMap>
      </BlurTargetView>

      <View style={styles.topWrap}>
        <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={70} tint={dark ? 'dark' : 'light'} style={styles.glassPanel}>
          {pack && !changeAreaOpen ? <>
          <Row style={{ gap: 10, alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={styles.eyebrow}>SAVED AREA</Text>
              <Text numberOfLines={1} style={styles.title}>{pack.label}</Text>
            </View>
            <Pill maxFontSizeMultiplier={1.4} tone={progress?.state === 'complete' ? 'green' : progress?.state === 'active' ? 'blue' : 'amber'}>{progress?.state === 'complete' ? 'READY OFFLINE' : progress?.state === 'active' ? `${Math.round(progress.percent)}%` : 'MAP NOT READY'}</Pill>
          </Row>
          <Row style={{ gap: 8 }}>
            <Pressable accessibilityRole="button" onPress={() => camera.current?.easeTo({ center: [pack.longitude, pack.latitude], zoom: 13, duration: 350, easing: 'ease' })} style={styles.headerAction}><Text style={styles.headerActionText}>Center map</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setChangeAreaOpen(true)} style={styles.headerAction}><Text style={styles.headerActionText}>Change area</Text></Pressable>
          </Row>
          </> : <>
          <Row style={{ marginBottom: 2 }}><View style={{ gap: 2, flex: 1, minWidth: 0 }}><Text style={styles.eyebrow}>STORMREADY · U.S. & MÉXICO</Text><Text style={styles.title}>Your map</Text></View><Pill tone={progress?.state === 'complete' ? 'green' : progress?.state === 'stalled' ? 'amber' : 'blue'}>{shelterStatus}</Pill></Row>
          {pack ? <Pressable accessibilityRole="button" onPress={() => setChangeAreaOpen(false)} hitSlop={8} style={styles.closeSearch}><Text style={styles.headerActionText}>Done changing area</Text></Pressable> : null}
          <Field label="Address, city, state, or postal code" value={query} onChangeText={setQuery} placeholder="Search in the U.S. or Mexico" />
          <Action title={busy ? 'Saving your area…' : 'Find & download this area'} onPress={locateAddress} />
          <Action title={busy ? 'Getting your location…' : 'Use my location & download map'} kind="secondary" onPress={useCurrentLocation} />
          <Text style={styles.helper}>Downloads map tiles, offline road directions, saved addresses and places, and nearby shelter details (map tiles up to 50 MB). Wi-Fi is recommended.</Text>
          {busy ? <ActivityIndicator color={colors.teal} /> : null}
          {saveProgress ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.helper}>{saveProgress}</Text> : null}
          </>}
          {pack && error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {!pack && error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </BlurView>
      </View>

      <View style={styles.mapControls}>
        <Pressable accessibilityRole="button" accessibilityLabel={following ? 'Stop following location' : 'Follow my location'} onPress={toggleFollowing} style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}>
          <Text style={styles.mapButtonSymbol}>{following ? '◎' : '⌖'}</Text>
        </Pressable>
      </View>

      <Animated.View
        style={[styles.sheet, sheetStyle]}
        onLayout={event => {
          const height = event.nativeEvent.layout.height;
          sheetHeight.set(height);
          if (contentsCollapsed) sheetTranslateY.set(Math.max(0, height - 82));
        }}
      >
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={78}
          tint={dark ? 'dark' : 'light'}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sheetContentLayer}>
        <View style={styles.sheetGrip} onLayout={event => setSheetGripHeight(event.nativeEvent.layout.height)}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.sheetTitle}>{pack ? 'Downloaded map contents' : 'Explore the map'}</Text>
            <Text numberOfLines={1} style={styles.sheetSub}>{pack ? `${markers.length} shelters · ${pack.routingGraphUri ? 'offline road navigation ready' : 'offline roads not saved'}` : 'Search an address to save an area offline'}</Text>
          </View>
          <Pill maxFontSizeMultiplier={1.4} tone={pack ? progress?.state === 'complete' ? 'green' : 'amber' : 'blue'}>{pack ? progress?.state === 'complete' ? `${progress.tiles} TILES` : progress?.state === 'active' ? `${Math.round(progress.percent)}%` : 'NOT SAVED' : 'OPEN MAP'}</Pill>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={contentsCollapsed ? 'Expand downloaded map contents' : 'Collapse downloaded map contents'}
            accessibilityState={{ expanded: !contentsCollapsed }}
            onPress={() => settleSheet(!contentsCollapsed)}
            style={styles.sheetToggle}
          >
            <Text style={styles.sheetToggleSymbol}>{contentsCollapsed ? '⌃' : '⌄'}</Text>
          </Pressable>
        </View>
        <ScrollView
          style={[styles.sheetScroll, sheetScrollMax ? { maxHeight: sheetScrollMax } : null]}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.sheetContent}
        >
        {selectedShelter ? <View style={styles.selectedShelter}>
          <Row style={{ alignItems: 'flex-start', gap: 10 }}><View style={{ flex: 1, gap: 3 }}><Text style={styles.sheetTitle}>{selectedShelter.name}</Text><Body>{selectedShelter.address}{selectedShelter.city ? `, ${selectedShelter.city}` : ''} · {selectedShelter.distance.toFixed(1)} mi</Body></View><Pressable accessibilityRole="button" accessibilityLabel="Dismiss selected shelter" onPress={() => setSelectedShelter(null)} hitSlop={10}><Text style={styles.dismiss}>×</Text></Pressable></Row>
          <Action small title="Route to shelter offline" onPress={() => void navigateTo(selectedShelter, selectedShelter.name)} />
        </View> : <>
          {currentZone.value ? <View style={styles.zoneResult}>
            <Text style={styles.zoneResultLabel}>{plan.zone.source === 'florida-lookup' ? 'VERIFIED EVACUATION ZONE' : 'YOUR EVACUATION ZONE'}</Text>
            <Text style={styles.zoneResultValue}>{currentZone.label}{plan.zone.county ? ` · ${plan.zone.county}` : ''}</Text>
            <Text style={styles.shelterAddress}>{currentZone.provenance}{currentZone.ageDays !== null ? ` · verified ${zoneAgeText(currentZone.ageDays)}` : ''}</Text>
            {plan.zone.source === 'florida-lookup' && pack?.evacuationZone?.status ? <Text style={styles.shelterAddress}>Current order: {pack.evacuationZone.status}</Text> : null}
            {currentZone.warning ? <Text accessibilityRole="alert" style={[styles.shelterAddress, { color: colors.warning, fontWeight: '700' }]}>{currentZone.warning}</Text> : null}
          </View> : pack?.zoneLookupFailed ? <Text style={styles.shelterAddress}>The zone lookup failed. No verified result is saved for offline access; refresh while connected.</Text> : <Text style={styles.shelterAddress}>{pack && isFlorida(pack) ? `No evacuation zone is recorded for this Florida address${pack.zoneCheckedAt ? ` · checked ${new Date(pack.zoneCheckedAt).toLocaleString()}` : ''}. Open Evacuation zones to check again.` : 'No evacuation zone is recorded on this device. Open Evacuation zones to enter and verify the zone published by your local emergency authority.'}</Text>}
          {pack?.shelters?.length ? <View style={{ gap: 5 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}><Text style={styles.sectionTitle}>Nearby shelters</Text><Row style={{ gap: 8, alignItems: 'center' }}><Pill maxFontSizeMultiplier={1.4} tone={pack.shelterCheckedAt ? 'green' : 'amber'}>{pack.shelterCheckedAt ? 'SAVED OFFLINE' : 'NOT SAVED'}</Pill><Pressable accessibilityRole="button" onPress={() => setSheltersOpen(true)}><Text style={styles.clearDestination}>See all {pack.shelters.length}</Text></Pressable></Row></Row>
            {pack.shelters.slice(0, 3).map((shelter, index) => <Pressable key={shelter.id} accessibilityRole="button" onPress={() => setSelectedShelter(shelter)} style={({ pressed }) => [styles.shelterRow, index > 0 && styles.divider, pressed && styles.pressed]}>
              <View style={{ flex: 1, gap: 2 }}><Text style={styles.shelterName}>{shelter.name}</Text><Text style={styles.shelterAddress}>{shelter.address}{shelter.city ? `, ${shelter.city}` : ''}</Text></View><Text style={styles.distance}>{shelter.distance.toFixed(1)} mi</Text>
            </Pressable>)}
            {pack.shelterCheckedAt ? <Text style={styles.shelterAddress}>Offline copy · checked {new Date(pack.shelterCheckedAt).toLocaleString()}</Text> : null}
          </View> : <Text style={styles.shelterAddress}>{pack ? `No nearby shelter locations were returned${pack.shelterCheckedAt ? ` · checked ${new Date(pack.shelterCheckedAt).toLocaleString()} and saved offline` : '. Refresh while connected to check and save this information.'}` : 'Drag and zoom the map to explore. Use the search above to download a nearby area.'}</Text>}
          {progress?.state === 'active' ? <View
            accessibilityRole="progressbar"
            accessibilityLabel="Offline map download progress"
            accessibilityLiveRegion="polite"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.percent) }}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, { width: `${Math.max(3, progress.percent)}%` }]} />
          </View> : null}
          {progress?.state === 'stalled' ? <Text accessibilityRole="alert" style={styles.shelterAddress}>The offline map tiles stopped downloading. The saved roads and addresses still work. Open Change area to try the map download again.</Text> : null}
          {progress?.state === 'missing' ? <Text accessibilityRole="alert" style={styles.shelterAddress}>The saved map tiles are no longer on this device. Download the area again while connected.</Text> : null}
          {roadCancelable ? <View style={styles.downloadBox}>
            <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.shelterAddress}>{saveProgress || routeProgress || 'Downloading offline road data…'}</Text>
            <Action small title="Skip road data" kind="secondary" onPress={skipRoadDownload} />
            <Text style={styles.dataNote}>The area is saved either way. Offline directions become available once the road data is downloaded.</Text>
          </View> : null}
          {pack ? <View style={styles.destinationBox}>
            <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Choose a destination</Text><Text style={styles.sectionCaption}>Saved on this device</Text></View>
            <Field label="Destination name or address" value={plan.destination.address} onChangeText={address => { plan.setDestination({ address }); setRoadRoute(null); setNavigating(false); setPinnedDestination(null); void setDestination(null); setError(''); }} placeholder="Search an address or saved shelter" />
            <Action small title={routeLoading ? (routeProgress || 'Finding route…') : 'Go to destination'} onPress={routeToEnteredDestination} />
            {routeLoading ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.shelterAddress}>Checking saved offline roads first; a live route may be used when the trip is outside this map.</Text> : null}
            {!pack.routingGraphUri ? <View style={{ gap: 6 }}>
              <Text style={styles.shelterAddress}>Offline roads were not saved yet. Pick a destination while connected and StormReady will download the road data for that trip, or download the roads for this area now.</Text>
              <Action small title={routeLoading ? 'Downloading road data…' : 'Download offline road data'} onPress={() => void downloadRoadsForSavedArea()} />
            </View> : null}
            <Text style={styles.shelterAddress}>{destinationIndex ? `${destinationIndex.destinations.length.toLocaleString()} saved addresses and places are searchable offline in this area.` : 'This saved area has no offline address search yet. Download the area again while connected to save addresses and places.'}</Text>
            {destinationSearchResults.map(destination => <Pressable key={destination.id} accessibilityRole="button" onPress={() => void navigateTo({ latitude: destination.latitude, longitude: destination.longitude }, destination.name)} style={styles.destinationResult}>
              <Text style={styles.shelterName}>{destination.name}</Text>
              <Text style={styles.shelterAddress}>{[destination.address !== destination.name ? destination.address : '', destination.city, destination.region].filter(Boolean).join(', ') || 'Saved in this offline map area'}</Text>
            </Pressable>)}
            {destinationMatch ? <Pressable accessibilityRole="button" onPress={() => void navigateTo(destinationMatch, destinationMatch.name)} style={styles.destinationResult}>
              <Text style={styles.shelterName}>{destinationMatch.name}</Text><Text style={styles.shelterAddress}>{destinationMatch.address}{destinationMatch.city ? `, ${destinationMatch.city}` : ''} · {destinationMatch.distance.toFixed(1)} mi</Text>
            </Pressable> : null}
            {destinationPoint ? <View style={styles.destinationResult}>
              <Text style={styles.shelterName}>{plan.destination.address.trim() || 'Pinned destination'}</Text>
              {roadRoute ? <Text style={styles.shelterAddress}>{roadRoute.source === 'offline' ? 'Offline road route' : 'Online driving route'} · {(roadRoute.distance / 1609.344).toFixed(1)} mi · about {Math.max(1, Math.round(roadRoute.duration / 60))} min</Text> : <Text style={styles.shelterAddress}>About {distanceMiles((current || pack).latitude, (current || pack).longitude, destinationPoint.latitude, destinationPoint.longitude).toFixed(1)} mi straight-line distance</Text>}
              {!navigating && roadRoute ? <Action small title={roadRoute.source === 'offline' ? 'Start offline navigation' : 'Start navigation'} onPress={() => void startGuidance()} /> : null}
              {navigating && roadRoute && nextGuidance ? <View style={styles.guidanceCard}>
                <Text style={styles.guidanceEyebrow}>{roadRoute.source === 'offline' ? 'OFFLINE TURN-BY-TURN' : 'TURN-BY-TURN · ONLINE ROUTE'}</Text>
                {offRoute ? <>
                  <Text style={styles.guidanceText}>You appear to be off route.</Text>
                  <Action small title="Recalculate from my location" kind="secondary" onPress={() => void startGuidance()} />
                </> : <>
                  <Text style={styles.guidanceDistance}>{distanceToManeuver >= 1000 ? `${(distanceToManeuver / 1000).toFixed(1)} km` : `${Math.round(distanceToManeuver / 10) * 10} m`}</Text>
                  <Text style={styles.guidanceText}>{nextGuidance.instruction}</Text>
                  {followingStep ? <Text style={styles.shelterAddress}>Then {followingStep.instruction.toLocaleLowerCase()}</Text> : null}
                  <Text style={styles.shelterAddress}>{remainingRouteMeters >= 1000 ? `${(remainingRouteMeters / 1000).toFixed(1)} km` : `${Math.round(remainingRouteMeters / 10) * 10} m`} to your destination · about {Math.max(1, Math.round(roadRoute.duration / 60))} min total</Text>
                </>}
                <Pressable accessibilityRole="button" onPress={() => { setNavigating(false); setFollowing(false); }}><Text style={styles.clearDestination}>End navigation</Text></Pressable>
              </View> : null}
              <Pressable accessibilityRole="button" onPress={() => { setRoadRoute(null); setPinnedDestination(null); void setDestination(null); }}><Text style={styles.clearDestination}>Clear destination</Text></Pressable>
            </View> : <Text style={styles.destinationHint}>Search an address while connected, choose a saved shelter, or long-press a spot on the downloaded map to set an offline destination.</Text>}
          </View> : null}
          <Row style={{ gap: 8 }}>
            <View style={{ flex: 1 }}><Action small title={pack && isFlorida(pack) ? pdfLoading ? 'Saving PDF…' : pack.countyMapUri ? 'Open saved evacuation PDF' : 'Save evacuation PDF offline' : 'Local safety resources'} kind="secondary" onPress={() => void openCountyMap()} /></View>
            <View style={{ flex: 1 }}><Action small title={pack && isFlorida(pack) ? 'Florida zone lookup' : 'Local safety resources'} kind="secondary" onPress={openZoneModal} /></View>
          </Row>
          <Text style={styles.dataNote}>Shelter locations are not live opening or capacity updates. Offline route guidance uses the road network saved with this map; trips that leave the saved area fetch their road data once while connected, then work offline. OSM-derived map · © OpenStreetMap contributors · © OpenMapTiles.</Text>
        </>}
        </ScrollView>
        </View>
      </Animated.View>

    </View>

    <Modal visible={zoneOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setZoneOpen(false)}>
      <View style={styles.modal}>
        <Row style={{ paddingHorizontal: 18, paddingBottom: 10 }}><Text style={styles.modalTitle}>Evacuation zones</Text><Pressable accessibilityRole="button" onPress={() => setZoneOpen(false)} hitSlop={8}><Text style={styles.dismiss}>Done</Text></Pressable></Row>
        {pack && isFlorida(pack) ? <>
          <View style={styles.zoneForm}>
            <Text style={styles.helper}>Florida addresses use the state’s official lookup below. Confirm the zone for your exact address, then refresh to save it on this device.</Text>
            {currentZone.value ? <View style={styles.zoneResult}>
              <Text style={styles.zoneResultLabel}>VERIFIED EVACUATION ZONE</Text>
              <Text style={styles.zoneResultValue}>{currentZone.label}{plan.zone.county ? ` · ${plan.zone.county}` : ''}</Text>
              <Text style={styles.shelterAddress}>{currentZone.provenance}{currentZone.ageDays !== null ? ` · verified ${zoneAgeText(currentZone.ageDays)}` : ''}</Text>
              {pack.evacuationZone?.status ? <Text style={styles.shelterAddress}>Current order: {pack.evacuationZone.status}</Text> : null}
              {currentZone.warning ? <Text accessibilityRole="alert" style={[styles.shelterAddress, { color: colors.warning, fontWeight: '700' }]}>{currentZone.warning}</Text> : null}
            </View> : pack.zoneLookupFailed ? <Body>The zone lookup failed, so no verified zone is available offline yet.</Body> : null}
            {pack ? <Action small title={sheltersRefreshing ? 'Refreshing offline data…' : 'Refresh offline data'} onPress={() => void refreshOfflineData()} /> : null}
            <Body>Evacuation zones are different from flood-risk maps. Follow current local evacuation orders.</Body>
          </View>
          <WebView source={{ uri: ZONE_LOOKUP }} startInLoadingState renderLoading={() => <ActivityIndicator style={{ marginTop: 30 }} color={colors.teal} />} />
        </> : <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.zoneForm}>
          <Text style={styles.helper}>Evacuation zones are set by state, municipal, and local authorities. Enter the zone published for your address and record where you verified it.</Text>
          {currentZone.value ? <View style={styles.zoneResult}>
            <Text style={styles.zoneResultLabel}>YOUR EVACUATION ZONE</Text>
            <Text style={styles.zoneResultValue}>{currentZone.label}{plan.zone.county ? ` · ${plan.zone.county}` : ''}</Text>
            <Text style={styles.shelterAddress}>{currentZone.provenance}{currentZone.ageDays !== null ? ` · verified ${zoneAgeText(currentZone.ageDays)}` : ''}</Text>
            {currentZone.warning ? <Text accessibilityRole="alert" style={[styles.shelterAddress, { color: colors.warning, fontWeight: '700' }]}>{currentZone.warning}</Text> : null}
          </View> : null}
          <Field label="Zone or evacuation area" value={zone} onChangeText={value => { setZone(value); setZoneSaved(false); }} placeholder="e.g. A, B, or Zone 3" />
          <Field label="County or local area" value={zoneCounty} onChangeText={value => { setZoneCounty(value); setZoneSaved(false); }} placeholder="e.g. Harris County" />
          <Field label="Notes (optional)" value={zoneNotes} onChangeText={value => { setZoneNotes(value); setZoneSaved(false); }} placeholder="Where you found it, or what to check next" multiline />
          <Field label="Source web address (optional)" value={zoneSourceUrl} onChangeText={value => { setZoneSourceUrl(value); setZoneSaved(false); }} placeholder="https://…" />
          {zoneError ? <Text accessibilityRole="alert" style={styles.error}>{zoneError}</Text> : null}
          {zoneSaved ? <Text accessibilityRole="alert" style={{ color: colors.success, fontSize: 12, fontWeight: '600' }}>Zone saved with today’s verification date.</Text> : null}
          <Action small title="Save my verified zone" onPress={saveManualZone} />
          <Body>Manual zones are labeled “entered by you.” StormReady warns when the verification date is more than 90 days old.</Body>
          {pack ? <Action small title={sheltersRefreshing ? 'Refreshing offline data…' : 'Refresh offline data'} kind="secondary" onPress={() => void refreshOfflineData()} /> : null}
          {OFFICIAL_ZONE_SOURCES.map(source => <Pressable key={source.url} accessibilityRole="link" onPress={() => void Linking.openURL(source.url).catch(() => {})} style={styles.sourceLink}>
            <Text style={styles.sourceText}>{source.label} ↗</Text>
            <Text style={styles.shelterAddress}>{source.note}</Text>
          </Pressable>)}
          <Body>Evacuation zones are different from flood-risk maps. Follow current local evacuation orders.</Body>
          <Action small title={pack?.countryCode === 'MX' ? 'Open Mexico risk atlas ↗' : 'Open U.S. emergency resources ↗'} kind="secondary" onPress={() => void Linking.openURL(pack?.countryCode === 'MX' ? MEXICO_RISK_ATLAS : US_EMERGENCY_RESOURCES)} />
        </ScrollView>}
      </View>
    </Modal>
    <Modal visible={sheltersOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheltersOpen(false)}>
      <View style={styles.modal}>
        <Row style={{ paddingHorizontal: 18, paddingBottom: 10, alignItems: 'center' }}>
          <View style={{ flex: 1, gap: 2 }}><Text style={styles.modalTitle}>Nearby shelters</Text><Text style={styles.shelterAddress}>{markers.length} locations within 50 km · nearest first</Text></View>
          <Pressable accessibilityRole="button" onPress={() => void refreshOfflineData()} hitSlop={8} style={{ paddingHorizontal: 8 }}><Text style={styles.clearDestination}>{sheltersRefreshing ? 'Updating…' : 'Refresh offline data'}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setSheltersOpen(false)} hitSlop={8}><Text style={styles.dismiss}>Done</Text></Pressable>
        </Row>
        <View style={styles.shelterDirectory}>
          <Field label="Filter shelters" value={shelterSearch} onChangeText={setShelterSearch} placeholder="Name, street, or city" />
          <Text style={styles.dataNote}>{pack?.countryCode === 'MX' ? 'These shelter points come from OpenStreetMap community listings and may be incomplete or outdated. Confirm with local Protección Civil before traveling.' : 'FEMA shelter records may be incomplete or change quickly. Confirm that a shelter is open and has space with local emergency management before traveling.'}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
            {filteredShelters.map((shelter, index) => <View key={shelter.id} style={[styles.directoryRow, index > 0 && styles.divider]}>
              <Pressable accessibilityRole="button" onPress={() => { setSheltersOpen(false); setSelectedShelter(shelter); camera.current?.easeTo({ center: [shelter.longitude, shelter.latitude], zoom: 14, duration: 450, easing: 'ease' }); }} style={{ flex: 1, gap: 3 }}>
                <Text style={styles.shelterName}>{shelter.name}</Text>
                <Text style={styles.shelterAddress}>{shelter.address}{shelter.city ? `, ${shelter.city}` : ''}</Text>
                <Text style={styles.shelterAddress}>{shelter.distance.toFixed(1)} mi away{shelter.phone ? ` · ${shelter.phone}` : ''}</Text>
                {shelter.pets ? <Text style={styles.shelterAddress}>Pets: {shelter.pets}</Text> : null}
                {shelter.wheelchair ? <Text style={styles.shelterAddress}>Wheelchair access: {shelter.wheelchair}</Text> : null}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Route to ${shelter.name}`} onPress={() => { setSheltersOpen(false); void navigateTo(shelter, shelter.name); }} style={styles.routeShelterButton}><Text style={styles.routeShelterText}>Route</Text></Pressable>
            </View>)}
            {!filteredShelters.length ? <Body>{markers.length ? 'No shelters match this filter.' : 'No shelter locations were returned for this area.'}</Body> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </Page>;
}

const createStyles = (colors: Palette, dark = false) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  absoluteMap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  topWrap: { position: 'absolute', left: 12, right: 12, top: 10 },
  glassPanel: { borderRadius: 25, overflow: 'hidden', padding: 16, gap: 8, backgroundColor: colors.surfaceContainer, borderWidth: 1, borderColor: colors.outlineVariant, shadowColor: '#1C2D27', shadowOpacity: 0.13, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.ink, fontSize: 25, lineHeight: 30, letterSpacing: -0.75, fontWeight: '800' },
  headerAction: { minHeight: 44, flex: 1, paddingHorizontal: 12, borderRadius: 12, backgroundColor: dark ? 'rgba(141,216,200,0.14)' : 'rgba(205,232,224,0.78)', alignItems: 'center', justifyContent: 'center' },
  headerActionText: { color: colors.tealDark, fontSize: 12, fontWeight: '700' },
  closeSearch: { alignSelf: 'flex-end', paddingHorizontal: 4, paddingVertical: 2 },
  helper: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  error: { color: colors.red, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  mapControls: { position: 'absolute', right: 14, top: '38%', gap: 9 },
  mapButton: { width: 48, height: 48, borderRadius: 17, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center', shadowColor: '#1C2D27', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  mapButtonSymbol: { color: colors.tealDark, fontSize: 23, fontWeight: '700' },
  sheet: { position: 'absolute', left: 10, right: 10, bottom: 10, maxHeight: '42%', borderRadius: 25, overflow: 'hidden', paddingHorizontal: 17, paddingTop: 10, paddingBottom: 14, gap: 9, backgroundColor: colors.surfaceContainerLow, borderWidth: 1, borderColor: colors.outlineVariant, shadowColor: '#1C2D27', shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 7 }, elevation: 8 },
  sheetContentLayer: { flex: 1, minHeight: 0, gap: 9 },
  sheetScroll: { flex: 1, minHeight: 0 },
  sheetWithPack: { maxHeight: '52%' },
  sheetGrip: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetToggle: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.outlineVariant },
  sheetToggleSymbol: { color: colors.tealDark, fontSize: 25, lineHeight: 29, fontWeight: '700', includeFontPadding: false, textAlign: 'center', textAlignVertical: 'center' },
  sheetContent: { gap: 9, paddingBottom: 4 },
  sheetTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, letterSpacing: -0.25, fontWeight: '700' },
  sheetSub: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  selectedShelter: { gap: 9 },
  dismiss: { color: colors.teal, fontSize: 17, fontWeight: '700', padding: 6, minHeight: 44, minWidth: 44, textAlign: 'center', textAlignVertical: 'center' },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.outlineVariant, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.teal },
  downloadBox: { padding: 11, borderRadius: 13, backgroundColor: dark ? colors.surfaceContainerHigh : 'rgba(205,232,224,0.6)', gap: 7 },
  dataNote: { color: colors.muted, fontSize: 10, lineHeight: 14 },
  destinationBox: { gap: 5 },
  sectionHeading: { gap: 2, paddingBottom: 2 },
  sectionTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: '800' },
  sectionCaption: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  destinationHint: { color: colors.muted, fontSize: 12, lineHeight: 17, paddingVertical: 2 },
  destinationResult: { padding: 10, borderRadius: 12, backgroundColor: dark ? colors.surfaceContainerHigh : 'rgba(222,237,229,0.8)', gap: 3 },
  guidanceCard: { padding: 12, borderRadius: 14, backgroundColor: dark ? colors.surfaceContainerHigh : 'rgba(205,232,224,0.75)', gap: 5 },
  guidanceEyebrow: { color: colors.tealDark, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  guidanceText: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  guidanceDistance: { color: colors.tealDark, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  zoneResult: { padding: 10, borderRadius: 12, backgroundColor: dark ? colors.warningContainer : 'rgba(255,223,158,0.38)', gap: 2 },
  zoneResultLabel: { color: colors.amber, fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.7 },
  zoneResultValue: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: '800' },
  sourceLink: { minHeight: 44, justifyContent: 'center', gap: 1, paddingTop: 4 },
  sourceText: { color: colors.tealDark, fontSize: 13, fontWeight: '700' },
  shelterRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  shelterDirectory: { flex: 1, paddingHorizontal: 18, gap: 10 },
  directoryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  routeShelterButton: { minWidth: 64, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: dark ? colors.surfaceContainerHigh : 'rgba(205,232,224,0.78)', alignItems: 'center', justifyContent: 'center' },
  routeShelterText: { color: colors.tealDark, fontSize: 12, fontWeight: '700' },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant },
  shelterName: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  shelterAddress: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  distance: { color: colors.tealDark, fontSize: 11, fontWeight: '700' },
  marker: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderColor: '#fff', borderWidth: 2, shadowColor: '#12211B', shadowOpacity: 0.26, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  placeMarker: { width: 29, height: 29, borderRadius: 15, backgroundColor: colors.teal },
  currentMarker: { width: 24, height: 24, backgroundColor: '#3478F6' },
  shelterMarker: { backgroundColor: colors.amber },
  destinationMarker: { width: 29, height: 29, borderRadius: 15, backgroundColor: colors.red },
  clearDestination: { color: colors.tealDark, fontSize: 11, lineHeight: 15, fontWeight: '700', paddingTop: 2, minHeight: 44, justifyContent: 'center' },
  markerCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  modal: { flex: 1, backgroundColor: colors.canvas, paddingTop: Platform.OS === 'ios' ? 14 : 8 },
  modalTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  zoneForm: { paddingHorizontal: 18, paddingBottom: 12, gap: 8 },
  pressed: { opacity: 0.83, transform: [{ scale: 0.985 }] },
});
const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette, true);

