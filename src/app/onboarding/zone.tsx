import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FormError, OnboardingPage } from '../../onboarding/ui';
import { usePlan } from '../../plan';
import { OFFICIAL_ZONE_SOURCES, validateManualZone, type ZoneValidation } from '../../zone/verification';
import { Action, Body, Card, Field, Pill, Row } from '../../ui';
import { useAppTheme } from '../../theme';

export default function ZoneStep() {
  const plan = usePlan();
  const router = useRouter();
  const { colors } = useAppTheme();
  const [value, setValue] = useState(plan.zone.value);
  const [county, setCounty] = useState(plan.zone.county || plan.household.county);
  const [notes, setNotes] = useState(plan.zone.notes);
  const [sourceUrl, setSourceUrl] = useState(plan.zone.sourceUrl);
  const [errors, setErrors] = useState<ZoneValidation['errors']>({});

  const next = () => {
    if (!value.trim()) {
      setErrors({});
      router.push('/onboarding/done');
      return;
    }
    const result = validateManualZone({
      value,
      county,
      verifiedAt: new Date().toISOString(),
      notes,
      sourceUrl,
    });
    if (!result.valid || !result.value) {
      setErrors(result.errors);
      return;
    }
    plan.setZone(result.value);
    router.push('/onboarding/done');
  };

  return <OnboardingPage
    step={3}
    eyebrow="Evacuation zone"
    title="Know your zone before you need it."
    subtitle="Florida addresses can be checked automatically. Everywhere else, enter what your local emergency authority publishes."
    footer={<>
      <Action title={value.trim() ? 'Save zone and continue' : 'Continue without a zone'} onPress={next} />
      <Action title="Back" kind="quiet" onPress={() => router.back()} />
    </>}
  >
    <Card>
      <Row style={{ alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.cardTitle, { color: colors.onSurface }]}>Your zone or evacuation area</Text>
          <Body>Use the letter, number, or name printed by your county or city. This is not a flood-risk map.</Body>
        </View>
        <Pill tone="blue">OPTIONAL</Pill>
      </Row>
      <Field label="Zone (for example A, B, or Zone 3)" value={value} onChangeText={setValue} placeholder="Enter the zone shown by your local authority" />
      {errors.value ? <FormError>{errors.value}</FormError> : null}
      <Field label="County or local area" value={county} onChangeText={setCounty} placeholder="e.g. Harris County" />
      {errors.county ? <FormError>{errors.county}</FormError> : null}
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Where you found it, or what to check next" multiline />
      {errors.notes ? <FormError>{errors.notes}</FormError> : null}
      <Field label="Source web address (optional)" value={sourceUrl} onChangeText={setSourceUrl} placeholder="https://…" />
      {errors.sourceUrl ? <FormError>{errors.sourceUrl}</FormError> : null}
      <Text style={[styles.footnote, { color: colors.muted }]}>Saving records today as the verification date. StormReady will remind you when the zone is more than 90 days old.</Text>
    </Card>

    <Card>
      <Text style={[styles.cardTitle, { color: colors.onSurface }]}>Check an official source</Text>
      <Body>Open your local emergency-management page, confirm the zone, then come back and save it. Links need a connection.</Body>
      {OFFICIAL_ZONE_SOURCES.map(source => <View key={source.url} style={[styles.source, { borderTopColor: colors.outlineVariant }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.sourceLabel, { color: colors.onSurface }]}>{source.label}</Text>
          <Text style={[styles.footnote, { color: colors.muted }]}>{source.note}</Text>
        </View>
        <Action title="Open ↗" kind="secondary" small onPress={() => void Linking.openURL(source.url).catch(() => {})} />
      </View>)}
    </Card>
  </OnboardingPage>;
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  footnote: { fontSize: 11, lineHeight: 16 },
  source: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  sourceLabel: { fontSize: 13, fontWeight: '700' },
});
