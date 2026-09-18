/**
 * The bottom bar.
 *
 * Instagram's is the reference: no labels on the icons in recent versions, no fill, no
 * line above it, the active tab shown by weight alone. Here it is a flat strip of the
 * same grey, and the active tab is a SUNKEN circle -- the one moment in the app where
 * navigation state is shown by depth.
 */
import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { radius, space, sunk, type, usePalette } from '../../components/ui';

function TabIcon({ glyph, focused, label }: { glyph: string; focused: boolean; label: string }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'center', gap: 2, width: 72 }}>
      <View
        style={{
          width: 40, height: 40, borderRadius: radius.pill,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: focused ? p.sunken : 'transparent',
          boxShadow: focused ? sunk(p, 3) : undefined,
        }}
      >
        <Text style={{ fontSize: 19, color: focused ? p.accent : p.textTertiary }}>{glyph}</Text>
      </View>
      <Text
        style={[
          type.label,
          { color: focused ? p.accent : p.textTertiary, fontSize: 10, letterSpacing: 0.4 },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const p = usePalette();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: p.bg },
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: p.bg,
          // Flat, per the spec. A raised bar would compete with every card above it.
          borderTopWidth: 0,
          elevation: 0,
          height: 76,
          paddingTop: space.sm,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="◉" focused={focused} label="TOWN" />,
          tabBarAccessibilityLabel: 'The town: watch your agent, tap it to talk',
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="◈" focused={focused} label="MATCHES" />,
          tabBarAccessibilityLabel: 'People your agent found',
        }}
      />
      {/* Chats sits between the two, because that is the order the product runs in:
          your agent learns you, it finds somebody, you talk. */}
      <Tabs.Screen
        name="chats"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="◎" focused={focused} label="CHATS" />,
          tabBarAccessibilityLabel: 'Your conversations',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon glyph="◐" focused={focused} label="YOU" />,
          tabBarAccessibilityLabel: 'Your profile',
        }}
      />
    </Tabs>
  );
}
