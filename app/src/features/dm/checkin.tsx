/**
 * The after-date check-in, in the chat where the two of them are.
 *
 * Three days after both said yes: "Did you two meet up?" (the one label in the
 * product that is a fact). After yes: a few yes / no / not sure questions about the
 * other person -- only about what this person was shown -- then "did you feel safe",
 * then "would you see them again". After no: one optional "what happened". Answers
 * are never shown to the other person; the only thing that crosses is a mutual yes to
 * "again". Points are the same whatever is answered.
 *
 * The order lives in ./checkin-flow.ts, which has no screen; this file draws whatever
 * the flow says and calls one transition per tap.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  blockUser, getCheckin, postCheckin, reportMet, reportUser, type CheckinState,
} from '../../lib/api';
import { Button, Chip, ChipGroup, StepsLeft, space, type, usePalette } from '../../components/ui';
import { again, answer, pastReportOffer, safety, start, stepsLeft, submission, type Flow } from './checkin-flow';

const WHY: Record<string, string> = {
  plans_fell_through: 'Plans fell through',
  stopped_replying: 'They stopped replying',
  changed_my_mind: 'I changed my mind',
  other: 'Something else',
};

export function Checkin({ token, rendezvousId, otherId, otherName }: {
  token: string;
  rendezvousId: string;
  otherId: string | null;
  otherName: string;
}) {
  const p = usePalette();
  const [state, setState] = useState<CheckinState | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await getCheckin(token, rendezvousId);
    setState(s);
    setFlow(s?.state === 'ask' && s.met ? start(s.questions) : null);
  }, [token, rendezvousId]);
  useEffect(() => { void load(); }, [load]);

  const answerMet = async (yes: boolean) => {
    if (busy) return;
    setBusy(true);
    await reportMet(token, rendezvousId, yes);
    setBusy(false);
    await load();
  };

  const submit = async (body: Parameters<typeof postCheckin>[2]) => {
    if (busy) return;
    setBusy(true);
    const r = await postCheckin(token, rendezvousId, body);
    setBusy(false);
    if (!r || 'error' in r) { setThanks('That did not save. Try again.'); return; }
    setThanks(r.awarded > 0 ? `Thanks. +${r.awarded} points.` : 'Thanks.');
    await load();
  };

  // Once the flow reaches done, send it. One request, at the end.
  useEffect(() => {
    if (!flow) return;
    const body = submission(flow);
    if (body) { setFlow(null); void submit(body); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  const stopHearing = (report: boolean) => {
    if (!otherId) return;
    const done = () => router.back();
    if (report) void reportUser(token, { userId: otherId, rendezvousId, reason: 'felt_unsafe' }).then(done);
    else void blockUser(token, otherId).then(done);
  };

  if (!state) return null;

  const wrap = (children: React.ReactNode) => (
    <View style={{ paddingHorizontal: space.screen, paddingBottom: space.sm, gap: space.sm }}>{children}</View>
  );
  const three = (on: (v: 'yes' | 'no' | 'unsure') => void) => (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <View style={{ flex: 1 }}><Button label="Yes" variant="secondary" onPress={() => on('yes')} /></View>
      <View style={{ flex: 1 }}><Button label="No" variant="secondary" onPress={() => on('no')} /></View>
      <View style={{ flex: 1 }}><Button label="Not sure" variant="ghost" onPress={() => on('unsure')} /></View>
    </View>
  );

  if (thanks) {
    return wrap(<Text style={[type.callout, { color: p.textSecondary, textAlign: 'center' }]}>{thanks}</Text>);
  }

  if (state.state === 'done') {
    return state.again
      ? wrap(<Text style={[type.callout, { color: p.success, textAlign: 'center' }]}>You both said you'd see each other again.</Text>)
      : null;
  }

  if (state.state === 'ask_met') {
    return wrap(
      <>
        <Text style={[type.callout, { color: p.textSecondary, textAlign: 'center' }]}>
          Did you two meet up? They are not told what you say.
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}><Button label="Yes" variant="secondary" onPress={() => void answerMet(true)} /></View>
          <View style={{ flex: 1 }}><Button label="Not yet" variant="ghost" onPress={() => void answerMet(false)} /></View>
        </View>
      </>,
    );
  }

  if (state.state === 'ask' && !state.met) {
    return wrap(
      <>
        <Text style={[type.callout, { color: p.textSecondary, textAlign: 'center' }]}>What happened? Only you see this.</Text>
        <ChipGroup>
          {state.whyNot.map((w) => (
            <Chip key={w} label={WHY[w] ?? w} selected={false} onPress={() => void submit({ whyNot: w })} />
          ))}
        </ChipGroup>
        <Button label="Skip" variant="ghost" onPress={() => void submit({})} />
      </>,
    );
  }

  if (state.state !== 'ask' || !flow) return null;
  const { left, total } = stepsLeft(flow);
  const step = flow.step;

  return wrap(
    <>
      <StepsLeft left={left} total={total} />
      {step.kind === 'question' && (
        <>
          <Text style={[type.body, { color: p.text, textAlign: 'center' }]}>{flow.questions[step.index]!.text}</Text>
          {three((v) => setFlow(answer(flow, v)))}
        </>
      )}
      {step.kind === 'safety' && (
        <>
          <Text style={[type.body, { color: p.text, textAlign: 'center' }]}>Did you feel safe with them?</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label="Yes" variant="secondary" onPress={() => setFlow(safety(flow, true))} /></View>
            <View style={{ flex: 1 }}><Button label="No" variant="secondary" onPress={() => setFlow(safety(flow, false))} /></View>
          </View>
        </>
      )}
      {step.kind === 'offer_report' && (
        <>
          <Text style={[type.body, { color: p.text, textAlign: 'center' }]}>
            {`Sorry. Do you want to stop hearing from ${otherName}?`}
          </Text>
          <Button label="Block" variant="secondary" onPress={() => stopHearing(false)} />
          <Button label="Block and report" variant="secondary" onPress={() => stopHearing(true)} />
          <Button label="Not now" variant="ghost" onPress={() => setFlow(pastReportOffer(flow))} />
        </>
      )}
      {step.kind === 'again' && (
        <>
          <Text style={[type.body, { color: p.text, textAlign: 'center' }]}>Would you see them again?</Text>
          <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>They only hear this if you both say yes.</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label="Yes" variant="secondary" onPress={() => setFlow(again(flow, true))} /></View>
            <View style={{ flex: 1 }}><Button label="No" variant="secondary" onPress={() => setFlow(again(flow, false))} /></View>
            <View style={{ flex: 1 }}><Button label="Not sure" variant="ghost" onPress={() => setFlow(again(flow, null))} /></View>
          </View>
        </>
      )}
    </>,
  );
}
