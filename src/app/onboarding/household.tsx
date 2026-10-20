import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingPage } from '../../onboarding/ui';
import { usePlan } from '../../plan';
import { Action, Body, Card, Field, Stepper, ToggleRow } from '../../ui';
import { useAppTheme } from '../../theme';

export default function HouseholdStep() {
  const plan = usePlan();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { household } = plan;
  return <OnboardingPage
    step={2}
    eyebrow="Your household"
    title="Who are you planning for?"
    subtitle="These answers size your kit. They stay on this device and can be changed at any time."
    footer={<>
      <Action title="Continue to zone" onPress={() => router.push('/onboarding/zone')} />
      <Action title="Back" kind="quiet" onPress={() => router.back()} />
    </>}
  >
    <Card>
      <Stepper label="People in your household" detail="Include everyone who would evacuate together." value={household.people} min={1} max={20} onChange={people => plan.setHousehold({ people })} />
      <Stepper label="Infants" detail="Under 2 years old. Formula and feeding supplies are added to your kit." value={household.infants} min={0} max={20} onChange={infants => plan.setHousehold({ infants })} />
      <Stepper label="Days of supplies" detail="Seven days is the shortest planning horizon in StormReady." value={household.days} min={7} max={30} onChange={days => plan.setHousehold({ days })} />
      <Field label="County or local area (optional)" value={household.county} onChangeText={county => plan.setHousehold({ county })} placeholder="e.g. Hillsborough County" />
    </Card>

    <Card>
      <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Needs to plan around</Text>
      <ToggleRow title="We have pets or service animals" detail="Adds pet supplies to your kit." value={household.pets} onPress={() => plan.setHousehold({ pets: !household.pets })} />
      {household.pets ? <Stepper label="Number of pets" value={household.petCount} min={1} max={20} onChange={petCount => plan.setHousehold({ petCount })} /> : null}
      <ToggleRow title="We have access to a vehicle" detail="Used to personalize your checklist." value={household.hasVehicle} onPress={() => plan.setHousehold({ hasVehicle: !household.hasVehicle })} />
      <ToggleRow title="Someone has medical needs" detail="Adds a prescription and medical-supply line to your kit." value={household.medicalNeeds} onPress={() => plan.setHousehold({ medicalNeeds: !household.medicalNeeds })} />
      <ToggleRow title="Someone has accessibility needs" detail="Adds backup accessibility supplies to your kit." value={household.accessibilityNeeds} onPress={() => plan.setHousehold({ accessibilityNeeds: !household.accessibilityNeeds })} />
    </Card>

    <View style={styles.note}>
      <Body>StormReady does not ask for location permission during setup. Location is only requested when you choose a location action on the Map or Updates screen.</Body>
      <Text style={[styles.footnote, { color: colors.muted }]}>Water guidance uses a planning baseline of one gallon per person per day.</Text>
    </View>
  </OnboardingPage>;
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  note: { gap: 6 },
  footnote: { fontSize: 11, lineHeight: 16 },
});
