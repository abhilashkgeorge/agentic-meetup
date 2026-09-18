/**
 * The few words over the town.
 *
 * One status line, the size of the pool, and one obvious next step -- the same three
 * things the old Home's cards said, at a tenth of the height, because the town is the
 * content now. Everything here is the design system; nothing is drawn by hand.
 */
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { World } from '../../lib/api';
import { missingLabel } from '../profile/fields';
import { Button, Card, Chip, ChipGroup, space, type, usePalette } from '../../components/ui';
import { roundActive } from './bridge';

export function Hud({
  world,
  onSendOut,
  onFinishSetup,
  said,
}: {
  world: World | null;
  onSendOut: () => void;
  onFinishSetup: () => void;
  /** How the last round went, said once. */
  said: string | null;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const active = roundActive(world);
  // The round's own count lands only when it is over; while it runs, the people it
  // is still to talk to are the seats the roster shows talking.
  const talking = world?.agents.filter((a) => a.kind === 'met' && a.state === 'talking').length ?? 0;
  const title = world?.square.city ? `${world.square.city} square` : 'The square';

  const status = !world
    ? 'Finding the square…'
    : active
      ? world.round?.status === 'queued'
        ? 'Your agent is heading out…'
        : talking > 0
          ? `Your agent is out — meeting ${talking} ${talking === 1 ? 'person' : 'people'}`
          : 'Your agent is out…'
      : !world.me.inPool
        ? (world.me.missing[0] ? missingLabel(world.me.missing[0]) : 'A few things missing')
        : said ?? `It knows ${world.me.knows} things about you`;

  return (
    <>
      <View pointerEvents="box-none"
            style={{ position: 'absolute', top: insets.top + space.sm, left: space.screen, right: space.screen, gap: space.sm }}>
        <Text style={[type.title, { color: p.text }]}>{title}</Text>
        <Card>
          <Text style={[type.body, { color: p.text }]}>{status}</Text>
          {world && world.me.inPool && (
            <ChipGroup>
              <Chip label={`${world.pool.total.toLocaleString()} people nearby`} selected={false} onPress={() => {}} disabled />
              <Chip label={`${world.targetsLeftToday} visits left today`} selected={false} onPress={() => {}} disabled />
            </ChipGroup>
          )}
        </Card>
      </View>

      <View pointerEvents="box-none"
            style={{ position: 'absolute', bottom: space.lg, left: space.screen, right: space.screen }}>
        {world && !world.me.inPool ? (
          <Button label="Finish setup" variant="primary" onPress={onFinishSetup} />
        ) : (
          <Button label={active ? 'Your agent is out…' : 'Send my agent out'} variant="primary"
                  onPress={onSendOut} disabled={!world || active} />
        )}
      </View>
    </>
  );
}
