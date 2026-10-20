import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { usePlan } from '../../plan';
import { calculateKit } from '../../kit/calculator';
import { formatGallons } from '../../kit/format';
import { visibleTasks } from '../../plan-schema';
import { zoneSummary } from '../../zone/verification';
import { Action, Body, Card, Field, Header, Label, MotionPressable as Pressable, Page, Pill, ProgressBar, Row, Stepper, ToggleRow } from '../../ui';
import { useAppTheme } from '../../theme';

export default function MyPlan() {
  const plan = usePlan();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { household } = plan;
  const visible = visibleTasks(plan.tasks, household);
  const done = visible.filter(t => t.done).length;
  const percent = visible.length ? Math.round(done / visible.length * 100) : 0;
  const kit = calculateKit(household);
  const water = kit.find(line => line.id === 'water')?.quantity ?? 0;
  const zone = zoneSummary(plan.zone);

  return <Page>
    <Header eyebrow="Your household plan" title="Make room for peace of mind." subtitle="A few practical details help turn preparedness into a plan that fits your household." />
    <Card style={{ backgroundColor: colors.navy, borderColor: colors.navy }}>
      <Row><View style={{ gap: 4 }}><Text style={{ color: colors.lime, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>YOUR CHECKLIST</Text><Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{done} of {visible.length} steps complete</Text></View><Text style={{ color: '#fff', fontSize: 25, fontWeight: '800' }}>{percent}%</Text></Row>
      <ProgressBar value={done} max={visible.length} label="Checklist progress" tint={colors.lime} />
      <Text style={{ color: colors.secondaryContainer, fontSize: 12, lineHeight: 18 }}>Your progress saves automatically and stays on this device.</Text>
    </Card>

    <Card>
      <Row><View style={{ flex: 1, gap: 3 }}><Label>Household details</Label><Body>Used to personalize your kit and checklist.</Body></View><Pill>PRIVATE</Pill></Row>
      <Field label="County or local area" value={household.county} onChangeText={county => plan.setHousehold({ county })} placeholder="e.g. Hillsborough County" />
      <Stepper label="People" detail="Everyone who would evacuate together." value={household.people} min={1} max={20} onChange={people => plan.setHousehold({ people })} />
      <Stepper label="Infants" value={household.infants} min={0} max={20} onChange={infants => plan.setHousehold({ infants })} />
      <Stepper label="Days to prepare" detail="Seven days is the shortest planning horizon." value={household.days} min={7} max={30} onChange={days => plan.setHousehold({ days })} />
      <ToggleRow title="We have pets or service animals" value={household.pets} onPress={() => plan.setHousehold({ pets: !household.pets })} />
      {household.pets ? <Stepper label="Number of pets" value={household.petCount} min={1} max={20} onChange={petCount => plan.setHousehold({ petCount })} /> : null}
      <ToggleRow title="We have access to a vehicle" value={household.hasVehicle} onPress={() => plan.setHousehold({ hasVehicle: !household.hasVehicle })} />
      <ToggleRow title="Someone has medical needs" value={household.medicalNeeds} onPress={() => plan.setHousehold({ medicalNeeds: !household.medicalNeeds })} />
      <ToggleRow title="Someone has accessibility needs" value={household.accessibilityNeeds} onPress={() => plan.setHousehold({ accessibilityNeeds: !household.accessibilityNeeds })} />
    </Card>

    <Card style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.tealDark, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }}>EMERGENCY KIT</Text><Text style={{ color: colors.ink, fontSize: 22, fontWeight: '900' }}>{formatGallons(water)}</Text><Text style={{ color: colors.tealDark, fontSize: 12, lineHeight: 17 }}>{household.people} {household.people === 1 ? 'person' : 'people'} × {household.days} days × 1 gallon per person per day</Text></View>
        <Pill>{kit.length} LINES</Pill>
      </Row>
      <Body style={{ color: colors.tealDark }}>Your full kit shows quantities, the basis for each number, and an official source. It works offline and can be shared as plain text.</Body>
      <Action title="Open my emergency kit" kind="secondary" onPress={() => router.push('/kit')} />
    </Card>

    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 3 }}><Label>Evacuation zone</Label><Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800' }}>{zone.label}</Text><Body>{zone.provenance}{zone.ageDays !== null ? ` · ${zone.ageDays} days ago` : ''}</Body></View>
        <Pill tone={zone.stale ? 'amber' : zone.value ? 'green' : 'blue'}>{zone.value ? (zone.stale ? 'RECHECK' : 'RECORDED') : 'NOT SET'}</Pill>
      </Row>
      {zone.warning ? <Text accessibilityRole="alert" style={{ color: colors.warning, fontSize: 12, lineHeight: 17, fontWeight: '600' }}>{zone.warning}</Text> : null}
      <Body>{plan.zone.source === 'florida-lookup' ? 'Florida addresses can be checked automatically from Map. Manual verification is available everywhere else.' : 'Enter the zone published by your county or local emergency authority from the Map screen. Automatic lookup is available for Florida addresses.'}</Body>
      <Action title="Review zone on Map" kind="secondary" onPress={() => router.push('/(tabs)/map')} />
    </Card>

    <Card><Row><View style={{ flex: 1, gap: 3 }}><Label>Preparedness checklist</Label><Body>Small steps add up. Tap to mark one complete.</Body></View><Pill>{done} / {visible.length}</Pill></Row>
      {visible.map((task, index) => <Pressable key={task.id} accessibilityRole="checkbox" accessibilityLabel={task.title} accessibilityHint={task.detail} accessibilityState={{ checked: task.done }} onPress={() => plan.toggleTask(task.id)} style={({ pressed }) => [{ minHeight: 44, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14, borderTopWidth: index ? 1 : 0, borderColor: colors.line }, pressed && { opacity: 0.76 }]}>
        <View style={{ width: 25, height: 25, marginTop: 1, borderRadius: 9, borderWidth: 1.5, borderColor: task.done ? colors.teal : colors.line, backgroundColor: task.done ? colors.teal : colors.paper, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>{task.done ? '✓' : ''}</Text></View>
        <View style={{ flex: 1, gap: 4 }}><Text style={{ fontSize: 14, fontWeight: '800', color: task.done ? colors.muted : colors.ink }}>{task.title}</Text><Text style={{ fontSize: 12, lineHeight: 18, color: colors.muted }}>{task.detail}</Text></View>
      </Pressable>)}
    </Card>

    <Card><Label>Where could you go?</Label><Body>Save a destination and how you would get there. Follow local evacuation instructions when a storm threatens.</Body>
      <Field label="Destination name" value={plan.destination.label} onChangeText={label => plan.setDestination({ label })} placeholder="Family, friend, or shelter" />
      <Field label="Address or location" value={plan.destination.address} onChangeText={address => plan.setDestination({ address })} placeholder="Add only if you choose to" />
      <Field label="Transportation plan" value={plan.destination.transport} onChangeText={transport => plan.setDestination({ transport })} placeholder="Who can drive? What is your backup?" multiline />
      <Body>Destination details are saved only on this device.</Body>
    </Card>

    <View style={{ gap: 8, marginTop: 6 }}>
      <Text style={{ color: colors.teal, fontSize: 10, fontWeight: '800', letterSpacing: 1.25 }}>U.S. & MEXICO PREPAREDNESS GUIDE</Text>
      <Text style={{ color: colors.ink, fontSize: 25, lineHeight: 30, fontWeight: '800', letterSpacing: -0.6 }}>A field guide for what comes next.</Text>
      <Body>General preparedness guidance. Check current instructions from your state, municipality, or local emergency authority.</Body>
    </View>
    <GuideSection title="Before hurricane season" subtitle="Build a kit and a household plan" content="Consider preparing at least seven days of supplies and follow current local guidance. Plan drinking water at one gallon per person per day, plus more for heat, pets, medical needs, and your circumstances. Gather shelf-stable food, medicines as prescribed, batteries, charging cables, a radio, first-aid items, important records, and cash. Decide where you will go, how you will get there, and who will check on each household member." />
    <GuideSection title="When a storm approaches" subtitle="Follow local alerts and orders" content="Check your local emergency-management updates and official weather alerts. Charge phones and power banks, fuel your vehicle if you have one, gather medications and documents, and confirm your destination and ride. Secure your home only as local officials advise. Leave when local officials order your area to evacuate." />
    <GuideSection title="If you evacuate" subtitle="Use your plan and follow official routes" content="Choose a destination outside the area under an evacuation order and confirm it is appropriate for your household. Bring your go-bag, identification, medicines, chargers, and pet supplies. Follow official evacuation routes and current road instructions; a saved map cannot show current closures or traffic." />
    <GuideSection title="Choosing a shelter" subtitle="Confirm it is open before you travel" content="Public shelters are a last resort. Shelter locations, opening times, eligibility, pet acceptance, and capacity vary by county and incident. Check your county’s current shelter information before going. A facility in an offline list is not proof that it is open or has space." />
    <GuideSection title="After the storm" subtitle="Wait for the all-clear" content="Return only when authorities say it is safe. Avoid floodwater, damaged buildings, and downed power lines. Use generators outdoors and away from doors, windows, and vents. Document damage only when conditions are safe and follow local recovery guidance." />
    <Card style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
      <Text style={{ color: colors.tealDark, fontWeight: '800', fontSize: 16 }}>Need assistance planning?</Text>
      <Body>Assistance registries and services vary by location. Contact your local emergency authority; this app does not register anyone for assistance.</Body>
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://www.gob.mx/proteccioncivil').catch(() => {})}><Text style={{ color: colors.tealDark, fontWeight: '800' }}>Mexico Protección Civil ↗</Text></Pressable>
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://www.ready.gov/').catch(() => {})}><Text style={{ color: colors.tealDark, fontWeight: '800' }}>U.S. Ready.gov ↗</Text></Pressable>
    </Card>
  </Page>;
}

function GuideSection({ title, subtitle, content }: { title: string; subtitle: string; content: string }) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)} style={({ pressed }) => ({ backgroundColor: colors.paper, borderRadius: 19, padding: 17, borderWidth: 1, borderColor: colors.line, opacity: pressed ? 0.86 : 1, gap: expanded ? 10 : 3 })}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.ink, fontWeight: '800', fontSize: 15 }}>{title}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{subtitle}</Text></View><Text style={{ color: colors.teal, fontSize: 20, fontWeight: '700' }}>{expanded ? '−' : '+'}</Text></View>
    {expanded ? <Animated.View entering={FadeIn.duration(120).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(100).reduceMotion(ReduceMotion.System)}>
      <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21, paddingTop: 5 }}>{content}</Text>
    </Animated.View> : null}
  </Pressable>;
}
