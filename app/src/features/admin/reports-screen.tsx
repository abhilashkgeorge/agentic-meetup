/**
 * Reports to review: the founder's desk.
 *
 * Only a reviewer ever reaches it. The row that opens it shows only when GET
 * /v1/admin/me answers, and every admin route answers 404 to anybody else -- the
 * screen is not the gate, the server is.
 *
 * Each report can end three ways, each a single tap that records the decision AND
 * carries it out (server api/admin.ts): no action; hide their photos; or ban, which
 * signs them out, takes them out of the pool and hides them from everybody, for good.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { decideReport, getAdminReports, getReportChat, type AdminReport, type ReportChatLine } from '../../lib/api';
import { useSession } from '../../store/session';
import {
  Button, ButtonRow, Card, Chip, ChipGroup, Empty, Header, Screen, ScreenTitle, space, type, usePalette,
} from '../../components/ui';
import { chatButtonLabel, chatLineLabel, contextLine, outcomeLabel, reasonLabel, reportedLabel } from './queue';

export default function ReportsScreen() {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const [all, setAll] = useState(false);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The chat kept with a report (server 0080), once the reviewer opens it.
  const [chats, setChats] = useState<Record<string, ReportChatLine[] | undefined>>({});

  const load = useCallback(async () => {
    if (!token) return;
    const r = await getAdminReports(token, all);
    setReports(r?.reports ?? []);
  }, [token, all]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (r: AdminReport, outcome: 'no_action' | 'photos_hidden' | 'banned') => {
    if (!token) return;
    setBusy(r.id);
    await decideReport(token, r.id, outcome);
    setBusy(null);
    await load();
  };

  const openChat = async (r: AdminReport) => {
    if (!token) return;
    const got = await getReportChat(token, r.id);
    setChats((c) => ({ ...c, [r.id]: got?.lines ?? [] }));
  };

  const ban = (r: AdminReport) => Alert.alert(
    `Ban ${r.reportedName ?? 'this person'}?`,
    'They are signed out, taken out of the pool and hidden from everybody, for good.',
    [{ text: 'Cancel', style: 'cancel' },
     { text: 'Ban', style: 'destructive', onPress: () => void decide(r, 'banned') }],
  );

  return (
    <Screen onRefresh={() => void load()} padded={false}>
      <Header title="" onBack={() => router.back()} />
      <ScreenTitle title="Reports" />
      <View style={{ paddingHorizontal: space.screen, gap: space.lg }}>
        <ChipGroup>
          <Chip label="Open" selected={!all} onPress={() => setAll(false)} />
          <Chip label="All" selected={all} onPress={() => setAll(true)} />
        </ChipGroup>
        {reports && reports.length === 0 && (
          <Empty title="Nothing to review" body="When somebody reports somebody, it shows up here." />
        )}
        {(reports ?? []).map((r) => (
          <Card key={r.id} label={reasonLabel(r.reason).toUpperCase()}>
            <Text style={[type.title, { color: p.text }]}>{reportedLabel(r)}</Text>
            {r.detail ? <Text style={[type.body, { color: p.text }]}>“{r.detail}”</Text> : null}
            <Text style={[type.callout, { color: p.textSecondary }]}>{contextLine(r)}</Text>
            {chatButtonLabel(r) && (chats[r.id] ? (
              // Their chat as it stood when the report was made; kept even after either
              // of them deleted their account.
              <View style={{ gap: space.xs }}>
                {chats[r.id]!.map((l, i) => (
                  <Text key={i} style={[type.callout, { color: l.from === 'them' ? p.text : p.textSecondary }]}>
                    {chatLineLabel(l)}
                  </Text>
                ))}
                <Button label="Hide the chat" variant="secondary" onPress={() => setChats((c) => ({ ...c, [r.id]: undefined }))} />
              </View>
            ) : (
              <Button label={chatButtonLabel(r)!} variant="secondary" onPress={() => void openChat(r)} />
            ))}
            <Text style={[type.callout, { color: p.textTertiary }]}>
              {new Date(r.at).toLocaleString()}{r.reporterKnown ? '' : ' · reporter has left'}
            </Text>
            {r.reviewed ? (
              <Text style={[type.callout, { color: p.textSecondary }]}>{outcomeLabel(r.outcome)}</Text>
            ) : !r.reportedId ? (
              // Kept after they deleted their account (server 0079): nobody to hide or
              // ban; it points at them again if they come back.
              <>
                <Text style={[type.callout, { color: p.textSecondary }]}>
                  If they come back with the same phone or handset, this report points at them again.
                </Text>
                <Button label="Close it" disabled={busy === r.id} onPress={() => void decide(r, 'no_action')} />
              </>
            ) : (
              <ButtonRow>
                <Button label="No action" disabled={busy === r.id} onPress={() => void decide(r, 'no_action')} style={{ flex: 1 }} />
                <Button label="Hide photos" disabled={busy === r.id} onPress={() => void decide(r, 'photos_hidden')} style={{ flex: 1 }} />
                <Button label="Ban" variant="primary" disabled={busy === r.id || r.banned} onPress={() => ban(r)} style={{ flex: 1 }} />
              </ButtonRow>
            )}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
