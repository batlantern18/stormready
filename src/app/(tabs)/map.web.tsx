import React, { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { httpJson } from '../../net/http';
import { findNearbyShelters, type Shelter } from '../../shelters';
import { usePlan } from '../../plan';
import { OFFICIAL_ZONE_SOURCES, validateManualZone, zoneSummary } from '../../zone/verification';
import { Action, Body, Card, Field, Header, MotionPressable as Pressable, Page, Pill, Row } from '../../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../../theme';
import { lookupEvacuationZone, type EvacuationZone } from '../../zone';

const DEFAULT_MAP = 'https://www.openstreetmap.org/export/embed.html?bbox=-127%2C14%2C-65%2C50&layer=mapnik';
type SearchPlace = { latitude: number; longitude: number; label: string; county: string; region: string; countryCode: 'US' | 'MX' };

async function findAddress(address: string): Promise<SearchPlace> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '1', countrycodes: 'us,mx', q: address })}`;
  let results: { lat: string; lon: string; display_name: string; address?: { state?: string; county?: string; country_code?: string } }[];
  try {
    results = await httpJson(url, {
      headers: { 'Accept-Language': 'en' },
      timeoutMs: 20_000,
      userAgent: 'StormReady/1.1 (address lookup)',
    });
  } catch {
    throw new Error('Address lookup is unavailable. Try again in a moment.');
  }
  const result = results[0];
  if (!result) throw new Error('No U.S. or Mexico address found. Try a more complete street address, city, or postal code.');
  const countryCode = result.address?.country_code?.toUpperCase();
  if (countryCode !== 'US' && countryCode !== 'MX') throw new Error('Search for an address in the United States or Mexico.');
  return { latitude: Number(result.lat), longitude: Number(result.lon), label: result.display_name, county: (result.address?.county || '').replace(/\s+County$/i, ''), region: result.address?.state || '', countryCode };
}

export default function MapScreenWeb() {
  const plan = usePlan();
  const { dark, colors } = useAppTheme();
  const styles = dark ? darkStyles : lightStyles;
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState<SearchPlace | null>(null);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [evacuationZone, setEvacuationZone] = useState<EvacuationZone | null>(null);
  const [zoneChecked, setZoneChecked] = useState(false);
  const [zoneLookupFailed, setZoneLookupFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState({
    value: plan.zone.value,
    county: plan.zone.county,
    notes: plan.zone.notes,
    sourceUrl: plan.zone.sourceUrl,
  });
  const [manualError, setManualError] = useState('');
  const [manualSaved, setManualSaved] = useState(false);
  const savedZone = zoneSummary(plan.zone);
  const mapUrl = place
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${place.longitude - 0.12}%2C${place.latitude - 0.09}%2C${place.longitude + 0.12}%2C${place.latitude + 0.09}&layer=mapnik&marker=${place.latitude}%2C${place.longitude}`
    : DEFAULT_MAP;

  const saveManualZone = () => {
    const result = validateManualZone({ ...manual, verifiedAt: new Date().toISOString() });
    if (!result.valid || !result.value) {
      setManualError(Object.values(result.errors).find(Boolean) || 'Check the zone details and try again.');
      return;
    }
    plan.setZone(result.value);
    setManual({ value: result.value.value, county: result.value.county, notes: result.value.notes, sourceUrl: result.value.sourceUrl });
    setManualError('');
    setManualSaved(true);
  };

  const searchAddress = async () => {
    const address = query.trim();
    if (!address || busy) {
      if (!address) setError('Enter a U.S. or Mexico address, city, or postal code.');
      return;
    }
    setBusy(true);
    setError('');
    setShelters([]);
    setEvacuationZone(null);
    setZoneChecked(false);
    setZoneLookupFailed(false);
    try {
      const result = await findAddress(address);
      setPlace(result);
      setManual(previous => ({ ...previous, county: previous.county || result.county }));
      const [shelterLookup, zoneLookup] = await Promise.allSettled([
        findNearbyShelters(result),
        result.countryCode === 'US' && /^(fl|florida)$/i.test(result.region.trim()) ? lookupEvacuationZone(result.latitude, result.longitude) : Promise.resolve(null),
      ]);
      if (shelterLookup.status === 'fulfilled') setShelters(shelterLookup.value);
      if (zoneLookup.status === 'fulfilled') {
        setEvacuationZone(zoneLookup.value);
      } else setZoneLookupFailed(true);
      setZoneChecked(true);
      const lookupErrors = [shelterLookup, zoneLookup].flatMap(lookup => lookup.status === 'rejected' ? [lookup.reason instanceof Error ? lookup.reason.message : 'A location lookup failed.'] : []);
      if (lookupErrors.length) setError(lookupErrors.join(' '));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not look up this address.');
    } finally {
      setBusy(false);
    }
  };

  return <Page>
    <Header eyebrow="Map & shelters" title="Find nearby shelters." subtitle="Search the United States or Mexico for nearby shelter locations." />
    <Card style={styles.searchCard}>
      <Row><Text style={styles.cardTitle}>Address lookup</Text><Pill tone="blue">U.S. · MEXICO</Pill></Row>
      <View style={styles.search}>
        <TextInput accessibilityLabel="Search a U.S. or Mexico address" value={query} onChangeText={setQuery} onSubmitEditing={() => void searchAddress()} placeholder="Address, city, or postal code" placeholderTextColor={colors.muted} returnKeyType="search" style={styles.input} />
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} onPress={() => void searchAddress()} style={({ pressed }) => [styles.searchButton, pressed && styles.pressed, busy && { opacity: 0.6 }]}><Text style={styles.searchButtonText}>{busy ? 'Searching…' : 'Find shelters'}</Text></Pressable>
      </View>
      {busy ? <ActivityIndicator color={colors.teal} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {place ? <View style={styles.results}>
        <Row style={{ alignItems: 'flex-start', gap: 10 }}><View style={{ flex: 1, gap: 3 }}><Text style={styles.cardTitle}>{place.county ? `${place.county}${place.countryCode === 'US' ? ' County' : ''}` : 'Search location'}</Text><Text style={styles.address}>{place.label}</Text></View><Pill>{shelters.length} NEARBY</Pill></Row>
        <View style={styles.zoneResult}>
          <View style={{ flex: 1, gap: 2 }}><Text style={styles.zoneLabel}>EVACUATION ZONE</Text><Text style={styles.zoneValue}>{place.countryCode !== 'US' || !/^(fl|florida)$/i.test(place.region.trim()) ? 'Check local emergency authority' : !zoneChecked ? 'Checking address…' : zoneLookupFailed ? 'Could not check zone' : evacuationZone?.zone ? `Zone ${evacuationZone.zone}` : 'No mapped zone found'}</Text>{evacuationZone?.county ? <Text style={styles.address}>{evacuationZone.county} County</Text> : null}{evacuationZone?.status ? <Text style={styles.address}>Current order: {evacuationZone.status}</Text> : null}</View>
          <Pill tone={evacuationZone ? 'amber' : 'blue'}>{place.countryCode !== 'US' || !/^(fl|florida)$/i.test(place.region.trim()) ? 'LOCAL DATA' : evacuationZone ? 'DETECTED' : zoneLookupFailed ? 'UNAVAILABLE' : zoneChecked ? 'NOT FOUND' : 'CHECKING'}</Pill>
        </View>
        <Text style={styles.note}>{place.countryCode === 'US' && /^(fl|florida)$/i.test(place.region.trim()) ? 'Florida zone data comes from its emergency management lookup. Elsewhere, check local authorities for zone and evacuation information.' : 'Evacuation zones and orders come from local authorities. Check your state, municipality, or Protección Civil for current instructions.'}</Text>
        <Text style={styles.note}>{place.countryCode === 'MX' ? 'Mexico listings are community mapped in OpenStreetMap and may be incomplete or outdated. Verify with Protección Civil before traveling.' : 'U.S. listings come from FEMA and may be incomplete or change quickly. Confirm that the location is open and has space with local emergency management.'}</Text>
        {shelters.length ? shelters.map(item => <View key={item.id} style={styles.shelterRow}>
          <View style={styles.shelterDot} />
          <View style={{ flex: 1, gap: 2 }}><Text style={styles.shelterName}>{item.name}</Text><Text style={styles.address}>{item.address}{item.city ? `, ${item.city}` : ''}</Text></View>
          <Text style={styles.distance}>{item.distance.toFixed(1)} mi</Text>
        </View>) : <Body>No nearby facilities were returned for this address. Check your county emergency office for current shelter locations.</Body>}
        <Text style={styles.note}>This directory does not confirm that a shelter is currently open or has space. Contact local authorities before traveling.</Text>
      </View> : null}
    </Card>

    <Card>
      <Row style={{ alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.cardTitle}>Verify your evacuation zone</Text>
          <Body>Florida addresses can be checked automatically above. For every other location, enter the zone published by your local emergency authority.</Body>
        </View>
        <Pill tone={savedZone.value ? 'green' : 'blue'}>{savedZone.value ? 'RECORDED' : 'NOT SET'}</Pill>
      </Row>
      {savedZone.value ? <View style={styles.zoneResult}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.zoneLabel}>{savedZone.label.toUpperCase()}</Text>
          <Text style={styles.zoneValue}>{savedZone.provenance}{savedZone.ageDays !== null ? ` · verified ${savedZone.ageDays} days ago` : ''}</Text>
          {savedZone.warning ? <Text accessibilityRole="alert" style={styles.error}>{savedZone.warning}</Text> : null}
        </View>
      </View> : null}
      <Field label="Zone or evacuation area" value={manual.value} onChangeText={value => { setManual(previous => ({ ...previous, value })); setManualSaved(false); }} placeholder="e.g. A, B, or Zone 3" />
      <Field label="County or local area" value={manual.county} onChangeText={county => { setManual(previous => ({ ...previous, county })); setManualSaved(false); }} placeholder="e.g. Harris County" />
      <Field label="Notes (optional)" value={manual.notes} onChangeText={notes => { setManual(previous => ({ ...previous, notes })); setManualSaved(false); }} placeholder="Where you found it, or what to check next" multiline />
      <Field label="Source web address (optional)" value={manual.sourceUrl} onChangeText={sourceUrl => { setManual(previous => ({ ...previous, sourceUrl })); setManualSaved(false); }} placeholder="https://…" />
      {manualError ? <Text accessibilityRole="alert" style={styles.error}>{manualError}</Text> : null}
      {manualSaved ? <Text accessibilityRole="alert" style={{ color: colors.success, fontSize: 12 }}>Zone saved with today’s verification date.</Text> : null}
      <Action title="Save my verified zone" onPress={saveManualZone} />
      <Body style={{ fontSize: 11 }}>Manual zones are labeled “entered by you.” StormReady warns when the verification date is more than 90 days old.</Body>
      {OFFICIAL_ZONE_SOURCES.map(source => <Pressable key={source.url} accessibilityRole="link" onPress={() => void Linking.openURL(source.url).catch(() => {})} style={styles.sourceLink}>
        <Text style={styles.sourceText}>{source.label} ↗</Text>
        <Text style={styles.note}>{source.note}</Text>
      </Pressable>)}
    </Card>

    <View style={styles.mapFrame}>
      {React.createElement('iframe', { title: 'OpenStreetMap of the United States and Mexico', src: mapUrl, style: { width: '100%', height: '100%', border: 0, filter: dark ? 'invert(0.88) hue-rotate(180deg) brightness(0.86) contrast(0.92)' : 'none' }, loading: 'lazy', referrerPolicy: 'no-referrer' })}
    </View>
    <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
    <Card>
      <Text style={styles.cardTitle}>Your plan, wherever you go</Text>
      <Body>Offline maps and saved shelter locations are available in the Android and iOS app. Confirm current shelter status and evacuation instructions with local officials.</Body>
      <Action title="U.S. FEMA emergency resources" onPress={() => void Linking.openURL('https://www.ready.gov/')} kind="secondary" />
      <Action title="Mexico national risk atlas" onPress={() => void Linking.openURL('https://www.atlasnacionalderiesgos.gob.mx/')} kind="secondary" />
    </Card>
  </Page>;
}

const createStyles = (colors: Palette, dark = false) => StyleSheet.create({
  searchCard: { padding: 16, gap: 12 },
  cardTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, borderRadius: 16, backgroundColor: colors.surfaceContainerHighest, borderWidth: 1, borderColor: colors.outline },
  input: { flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 11, paddingVertical: 10, color: colors.ink, fontSize: 16 },
  searchButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, borderRadius: 12, backgroundColor: colors.tealDark },
  searchButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  results: { gap: 10, paddingTop: 4 },
  shelterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.outlineVariant, paddingTop: 10 },
  shelterDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.amber },
  shelterName: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  address: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  distance: { color: colors.tealDark, fontSize: 12, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 11, lineHeight: 16, paddingTop: 3 },
  zoneResult: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: dark ? colors.warningContainer : 'rgba(255,223,158,0.38)' },
  zoneLabel: { color: colors.amber, fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.7 },
  zoneValue: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  sourceLink: { minHeight: 44, justifyContent: 'center', gap: 1, paddingTop: 4 },
  sourceText: { color: colors.tealDark, fontSize: 13, fontWeight: '700' },
  error: { color: colors.red, fontSize: 12, lineHeight: 17 },
  mapFrame: { width: '100%', height: 320, overflow: 'hidden', borderRadius: 22, backgroundColor: colors.surfaceContainer, borderWidth: 1, borderColor: colors.outlineVariant },
  attribution: { marginTop: -11, color: colors.muted, fontSize: 11, textAlign: 'right' },
});
const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette, true);
