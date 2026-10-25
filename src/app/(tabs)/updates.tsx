import * as Location from 'expo-location';
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { httpJson } from '../../net/http';
import { keys } from '../../storage/keys';
import { load, save } from '../../storage/store';
import type { AlertItem, AlertSnapshot } from '../../alerts';
import type { AlertSnapshotMap } from '../../storage/keys';
import { Action, Body, Card, Field, Header, Page, Pill, Row } from '../../ui';
import { useAppTheme } from '../../theme';
import { usePlan } from '../../plan';

export default function Updates() {
  const { colors } = useAppTheme();
  const { profileId } = usePlan();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [state, setState] = useState<'idle'|'loading'|'success'|'error'|'mexico'>('idle');
  const [checked, setChecked] = useState<string>('');
  const [message, setMessage] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [alertPoint, setAlertPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [snapshotAvailable, setSnapshotAvailable] = useState(false);
  const [showingSavedCopy, setShowingSavedCopy] = useState(false);
  const [snapshotCountry, setSnapshotCountry] = useState<'US' | 'MX' | null>(null);
  React.useEffect(() => {
    load(keys.alerts).then(map => {
      const snapshot = (map as AlertSnapshotMap)[profileId];
      if (!snapshot) return;
      setAlerts(snapshot.alerts);
      setAlertPoint(snapshot.point);
      setChecked(snapshot.checked);
      setSnapshotCountry(snapshot.countryCode);
      setSnapshotAvailable(true);
      setShowingSavedCopy(true);
      setState(snapshot.countryCode === 'MX' ? 'mexico' : 'success');
      if (snapshot.countryCode === 'MX') setMessage('Showing saved Mexico source guidance. Current alerts require checking official local sources.');
    }).catch(() => {});
  }, [profileId]);
  const storeSnapshot = (snapshot: AlertSnapshot) => {
    setSnapshotAvailable(true);
    setSnapshotCountry(snapshot.countryCode);
    void (async () => {
      const map = await load(keys.alerts).catch(() => ({}) as AlertSnapshotMap);
      await save(keys.alerts, { ...(map ?? {}), [profileId]: snapshot });
    })();
  };
  const checkCoordinates = async (latitude: number, longitude: number, resolvedCountry?: string) => {
    setAlertPoint({ latitude, longitude });
    const [address] = resolvedCountry ? [] : await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
    const countryCode = resolvedCountry || address?.isoCountryCode?.toUpperCase();
    if (countryCode && countryCode !== 'US' && countryCode !== 'MX') throw new Error('Automated alerts are currently set up for the United States. Check your local official alert source.');
    if (countryCode === 'MX') {
      const checkedAt = new Date().toLocaleString();
      setAlerts([]); setChecked(checkedAt); setState('mexico'); setShowingSavedCopy(false);
      storeSnapshot({ alerts: [], point: { latitude, longitude }, checked: checkedAt, countryCode: 'MX' });
      setMessage('Automated in-app weather alerts are available for U.S. locations. For Mexico, check the official national and local sources below.');
      return;
    }
    const data = await httpJson<{ features?: AlertItem[] }>(
      `https://api.weather.gov/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`,
      {
        headers: { Accept: 'application/geo+json' },
        timeoutMs: 20_000,
        userAgent: 'StormReady/1.2 (weather alert check)',
      },
    ).catch(() => { throw new Error('The alert service could not be reached.'); });
    const checkedAt = new Date().toLocaleString();
    const latestAlerts = data.features ?? [];
    setAlerts(latestAlerts); setChecked(checkedAt); setState('success'); setShowingSavedCopy(false);
    storeSnapshot({ alerts: latestAlerts, point: { latitude, longitude }, checked: checkedAt, countryCode: 'US' });
  };
  const refresh = async () => {
    setState('loading'); setMessage('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Location permission is off. Enter an address below to check a U.S. location instead.');
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      await checkCoordinates(location.coords.latitude, location.coords.longitude);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Could not reach the alert service.';
      if (snapshotAvailable) {
        setState(snapshotCountry === 'MX' ? 'mexico' : 'success');
        setShowingSavedCopy(true);
        setMessage(`${reason} Showing the saved check from ${checked}; it may be out of date.`);
      } else { setState('error'); setMessage(`${reason} Check the official sources below.`); }
    }
  };
  const checkAddress = async () => {
    const query = addressQuery.trim();
    if (!query) { setState('error'); setMessage('Enter a U.S. address, city, or ZIP code.'); return; }
    setState('loading'); setMessage('');
    try {
      const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '1', countrycodes: 'us,mx', q: query });
      const results = await httpJson<{ lat: string; lon: string; address?: { country_code?: string } }[]>(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        {
          headers: { 'Accept-Language': 'en' },
          timeoutMs: 20_000,
          userAgent: 'StormReady/1.2 (weather alert address lookup)',
        },
      ).catch(() => { throw new Error('Address lookup is unavailable. Check your connection and try again.'); });
      const result = results[0];
      if (!result) throw new Error('No U.S. or Mexico address found. Try a fuller address, city, or ZIP code.');
      await checkCoordinates(Number(result.lat), Number(result.lon), result.address?.country_code?.toUpperCase());
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Could not look up that address.';
      if (snapshotAvailable) {
        setState(snapshotCountry === 'MX' ? 'mexico' : 'success');
        setShowingSavedCopy(true);
        setMessage(`${reason} Showing the saved check from ${checked}; it may be out of date.`);
      } else { setState('error'); setMessage(reason); }
    }
  };
  const open = (url: string) => Linking.openURL(url).catch(() => {
    setState('error');
    setMessage('Could not open that official source. Check your internet connection and try again.');
  });
  const openAlert = () => {
    if (!alertPoint) {
      setState('error');
      setMessage('Check a location first to open its Weather.gov alert page.');
      return;
    }
    const url = `https://forecast.weather.gov/MapClick.php?lat=${alertPoint.latitude.toFixed(5)}&lon=${alertPoint.longitude.toFixed(5)}`;
    void open(url);
  };
  return <Page>
    <Header eyebrow="Weather & safety" title="Know what’s happening nearby." subtitle="Check U.S. National Weather Service alerts for your location, or open official Mexico sources." />
    <Card style={{ backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant }}>
      <Row><Pill tone="amber">LIVE CHECK</Pill></Row>
      <Text style={{ color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: '800' }}>Check active alerts around you</Text>
      <Body>Your location or entered address selects the alert source. U.S. coordinates are sent to the National Weather Service and the latest result is saved only on this device so you can review it offline.</Body>
      <Action title={state === 'loading' ? 'Checking your area…' : 'Check my area'} onPress={refresh} />
      <Field label="Or enter an address" value={addressQuery} onChangeText={setAddressQuery} placeholder="U.S. or Mexico address, city, or postal code" />
      <Action title={state === 'loading' ? 'Looking up address…' : 'Check this address'} kind="secondary" onPress={() => void checkAddress()} />
      <Body style={{ fontSize: 11 }}>Address searches are sent to OpenStreetMap’s Nominatim service. © OpenStreetMap contributors. StormReady does not save the address.</Body>
      {state === 'loading' ? <ActivityIndicator accessibilityLabel="Checking for current alerts" accessibilityLiveRegion="polite" color={colors.teal} /> : null}
      {checked ? <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 11 }}>{showingSavedCopy ? 'Saved offline copy · ' : 'Last checked · '}{checked}</Text> : null}
      {showingSavedCopy ? <Body style={{ color: colors.amber, fontSize: 11 }}>Saved for {alertPoint ? `${alertPoint.latitude.toFixed(3)}, ${alertPoint.longitude.toFixed(3)}` : 'the last checked area'}. This snapshot may be outdated; recheck when you have a connection.</Body> : null}
      {state === 'error' || state === 'mexico' ? <Body style={{ color: state === 'error' ? colors.red : colors.muted }}>{message}</Body> : null}
    </Card>
    {state === 'success' || (state === 'loading' && snapshotAvailable && snapshotCountry === 'US') ? <Card>
      <Row><Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>Nearby alerts</Text><Pill tone={alerts.length ? 'amber' : 'green'}>{alerts.length ? `${alerts.length} ACTIVE` : 'NONE FOUND'}</Pill></Row>
      {alerts.length ? alerts.map(item => <View key={item.id} style={{ gap: 7, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.line }}>
        <Text style={{ color: colors.red, fontWeight: '900' }}>{item.properties.event}</Text>
        <Text style={{ color: colors.ink, fontWeight: '700', lineHeight: 20 }}>{item.properties.headline || 'Follow the official alert for details.'}</Text>
        <Body>{[item.properties.areaDesc, item.properties.ends ? `Ends ${new Date(item.properties.ends).toLocaleString()}` : '', item.properties.senderName].filter(Boolean).join(' · ')}</Body>
        {item.properties.description ? <Body>{item.properties.description}</Body> : null}
        {item.properties.instruction ? <Body style={{ color: colors.ink }}>{item.properties.instruction}</Body> : null}
        <Action title="View this area on Weather.gov ↗" kind="secondary" small onPress={openAlert} />
      </View>) : <Body>No active alerts were returned for this location at {checked}. Refresh or check your local emergency office for current orders.</Body>}
    </Card> : null}
    <Card><Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800' }}>Keep official sources close</Text>
      <Body>Emergency orders come from local emergency management. Weather watches and warnings come from the National Weather Service.</Body>
      <Action title="NWS alerts map ↗" kind="secondary" onPress={() => open('https://www.weather.gov/')} />
      <Action title="Mexico Protección Civil ↗" kind="secondary" onPress={() => open('https://www.gob.mx/proteccioncivil')} />
      <Action title="Mexico weather service (SMN) ↗" kind="secondary" onPress={() => open('https://smn.conagua.gob.mx/es/')} />
      <Action title="Mexico risk atlas (CENAPRED) ↗" kind="secondary" onPress={() => open('https://www.atlasnacionalderiesgos.gob.mx/')} />
      <Action title="Ready.gov hurricane guidance ↗" kind="secondary" onPress={() => open('https://www.ready.gov/hurricanes')} />
    </Card>
    <Body style={{ textAlign: 'center', fontSize: 11, lineHeight: 17 }}>An empty result is not a guarantee of safety. This app is not emergency dispatch. Call 911 for immediate danger and follow local instructions.</Body>
  </Page>;
}
