/**
 * The screen that appears instead of the app dying.
 *
 * A JavaScript error anywhere in the tree used to end the session: white screen on a
 * release build, and no way to tell whether the crash was in the app, the network or
 * the phone. Worse, it takes the ERROR with it -- the one piece of information that
 * would explain what happened is exactly what is lost.
 *
 * expo-router exports a route-level boundary, but that only covers a rendered route.
 * This wraps the whole tree, including the layout and the startup effects, which is
 * where the last three problems actually were.
 */
import { Component, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, dark, space, type } from './ui';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Console, not a crash reporter: there is no crash reporter yet, and a Metro log
    // is worth a great deal when the alternative is a phone that went blank.
    console.error('[fatal]', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // The dark palette directly, not usePalette: hooks are unavailable in a class,
    // and a boundary that itself needs context is a boundary that can fail twice.
    const p = dark;
    const detail = `${error.name}: ${error.message}\n\n${error.stack ?? ''}`;

    return (
      <View style={{ flex: 1, backgroundColor: p.bg, padding: space.lg, gap: space.lg }}>
        <Text style={[type.title, { color: p.text }]}>Something broke</Text>
        <Text style={[type.body, { color: p.textSecondary }]}>
          This is our fault, not yours. Nothing you had saved is lost.
        </Text>
        <ScrollView
          style={{ maxHeight: 260, backgroundColor: p.sunken, borderRadius: 12 }}
          contentContainerStyle={{ padding: space.md }}
        >
          <Text style={[type.callout, { color: p.textSecondary, fontFamily: 'Menlo' }]}>
            {detail}
          </Text>
        </ScrollView>
        <Button label="Copy the details" variant="secondary" onPress={() => void Clipboard.setStringAsync(detail)} />
        <Button label="Try again" onPress={() => this.setState({ error: null })} />
      </View>
    );
  }
}
