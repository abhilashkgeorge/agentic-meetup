/**
 * Changing one thing about yourself.
 *
 * WHY IT EXISTS. The profile listed Height and Diet as "Not set" and there was nothing
 * anywhere in the app that could set them: the only writer was the onboarding flow, and
 * it covers six fields, neither of them among those. A row that names a value and
 * offers no way to give it one is a dead end with a label on it.
 *
 * ONE FIELD PER SCREEN, and it saves and leaves. A settings form with ten rows and a
 * Save button at the bottom is the shape this app is trying not to be -- and it is the
 * shape that makes people abandon a change halfway through.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getKnowledge, setEssential } from '../../lib/api';
import { useSession } from '../../store/session';
import { FIELD_BY_KEY } from './fields';
import {
  Button, Chip, ChipGroup, Field, Header, Screen, space, type, usePalette,
} from '../../components/ui';

export default function EditBasic() {
  const p = usePalette();
  const { predicate } = useLocalSearchParams<{ predicate: string }>();
  const token = useSession((s) => s.token);
  const field = FIELD_BY_KEY.get(String(predicate));

  const [chosen, setChosen] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // What it already says, so the screen opens on the current answer rather than blank.
  const load = useCallback(async () => {
    if (!token || !field) return;
    const k = await getKnowledge(token);
    const mine = (k?.knows ?? []).filter((f) => f.predicate === field.key);
    if (!mine.length) return;
    if (field.kind === 'many') setChosen(mine.map((f) => f.value));
    else if (field.kind === 'one') setChosen([mine[0]!.value]);
    else setText(mine[0]!.value);
  }, [token, field]);

  useEffect(() => { void load(); }, [load]);

  if (!field) {
    return (
      <Screen center footer={<Button label="Back" onPress={() => router.back()} />}>
        <Text style={[type.body, { color: p.textSecondary }]}>Nothing to edit here.</Text>
      </Screen>
    );
  }

  const value = field.kind === 'one' || field.kind === 'many' ? chosen : text.trim();
  const ready = Array.isArray(value) ? value.length > 0 : value.length > 0;

  const save = async (answer: string | string[] | null): Promise<void> => {
    if (!token) return;
    setBusy(true);
    const r = await setEssential(token, field.key, answer);
    setBusy(false);
    if (!r) { setNote('Could not reach the server.'); return; }
    router.back();
  };

  return (
    <Screen
      footer={
        <>
          <Button
            label="Save"
            variant="primary"
            disabled={!ready || busy}
            loading={busy}
            onPress={() => void save(field.kind === 'many' ? chosen : (value as string[])[0] ?? text.trim())}
          />
          {/* A recorded refusal, not a blank. The question queue must know the
              difference between "never asked" and "asked, and they declined". */}
          <Button label="Prefer not to say" variant="ghost" onPress={() => void save(null)} />
        </>
      }
    >
      <Header title="" onBack={() => router.back()} />

      <View style={{ gap: space.xs }}>
        <Text style={[type.display, { color: p.text }]}>{field.title}</Text>
        {field.hint && (
          <Text style={[type.body, { color: p.textSecondary }]}>{field.hint}</Text>
        )}
      </View>

      {field.options ? (
        <ChipGroup>
          {field.options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <Chip
                key={o.value}
                label={o.label}
                selected={on}
                onPress={() =>
                  setChosen((prev) =>
                    field.kind === 'many'
                      ? prev.includes(o.value) ? prev.filter((v) => v !== o.value) : [...prev, o.value]
                      : [o.value],
                  )
                }
              />
            );
          })}
        </ChipGroup>
      ) : (
        <Field
          value={text}
          onChangeText={setText}
          placeholder={field.kind === 'number' ? 'A number' : 'Type it'}
          keyboardType={field.kind === 'number' ? 'number-pad' : 'default'}
          autoFocus
        />
      )}

      {note && <Text style={[type.callout, { color: p.danger }]}>{note}</Text>}
    </Screen>
  );
}
