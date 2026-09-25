/**
 * Block or report: the same sheet on every card, profile and chat.
 *
 * BLOCK hides both people from each other everywhere, for good -- the cards between
 * them, the profile, the chat, the town (server 0064 apart()). They are never told.
 * REPORT gives one of the fixed reasons (reasons.ts), blocks too, and goes to the
 * reviewer's queue. The support address is on the sheet, for anything urgent.
 *
 * A card or a profile names the MATCH, never a person: the server works out who the
 * other half is, and only for a match the caller is half of. A chat knows who.
 */
import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, Text, View } from 'react-native';
import { blockMatch, blockUser, reportMatch, reportUser } from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Button, Chip, ChipGroup, Field, Surface, radius, space, type, usePalette,
} from '../../components/ui';
import { REPORT_REASONS, SUPPORT_EMAIL, supportMailto, type ReportReason } from './reasons';

export function SafetySheet({ target, name, onClose, onDone }: {
  /** A match (from a card or a profile), or a person with their match (from a chat). */
  target: { rendezvousId: string; userId?: string };
  /** How to call them in the sheet: a first name, or "them". */
  name?: string;
  onClose: () => void;
  /** After a block or a report: the caller leaves or reloads -- they are gone now. */
  onDone: () => void;
}) {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState(false);
  const who = name ?? 'them';

  const block = () => {
    Alert.alert(
      `Block ${who}?`,
      'You will never see each other again, anywhere in the app. They are not told.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block', style: 'destructive',
          onPress: () => {
            if (!token) return;
            const done = target.userId ? blockUser(token, target.userId) : blockMatch(token, target.rendezvousId);
            void done.then(() => { onClose(); onDone(); });
          },
        },
      ],
    );
  };

  const report = async () => {
    if (!token || !reason) return;
    setBusy(true);
    const args = { rendezvousId: target.rendezvousId, reason, detail: detail.trim() };
    const ok = target.userId ? await reportUser(token, { ...args, userId: target.userId }) : await reportMatch(token, args);
    setBusy(false);
    if (ok) setThanks(true);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' }} onPress={onClose} />
      <Surface radius={radius.lg} style={{ padding: space.screen, gap: space.md }}>
        {thanks ? (
          <>
            <Text style={[type.title, { color: p.text }]}>Thank you</Text>
            <Text style={[type.body, { color: p.textSecondary }]}>
              {who === 'them' ? 'They' : who} can't reach you any more, and somebody will look at this.
            </Text>
            <Button label="Done" variant="primary" onPress={() => { onClose(); onDone(); }} />
          </>
        ) : (
          <>
            <Text style={[type.title, { color: p.text }]}>Block or report</Text>
            <Button label={`Block ${who}`} variant="secondary" onPress={block} />
            <Text style={[type.label, { color: p.textSecondary }]}>REPORT -- WHAT HAPPENED?</Text>
            <ChipGroup>
              {REPORT_REASONS.map((r) => (
                <Chip key={r.id} label={r.label} selected={reason === r.id} onPress={() => setReason(r.id)} />
              ))}
            </ChipGroup>
            <Field value={detail} onChangeText={setDetail} placeholder="Anything else we should know (optional)"
                   multiline minHeight={60} maxLength={2000} />
            <Button label="Report and block" variant="primary" disabled={!reason} loading={busy} onPress={() => void report()} />
            <Pressable onPress={() => void Linking.openURL(supportMailto('Report'))} accessibilityRole="link">
              <Text style={[type.callout, { color: p.textTertiary, textAlign: 'center' }]}>
                Something urgent? Write to {SUPPORT_EMAIL}
              </Text>
            </Pressable>
            <View style={{ height: space.sm }} />
          </>
        )}
      </Surface>
    </Modal>
  );
}
