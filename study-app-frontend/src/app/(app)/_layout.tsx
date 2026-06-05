import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { F, useTheme } from '@/lib/theme';
/**
 * When the user taps a tab they're already on, pop that tab's inner Stack
 * back to its root. Without this, react-navigation preserves the inner stack
 * so tapping Library after visiting a doc detail keeps you on the detail —
 * which feels wrong (the user expects "tap Library → see all my docs").
 *
 * Inlines the StackActions.popToTop() action so we don't need a direct
 * @react-navigation/native import.
 */
function popToRootOnRetap({ navigation }: { navigation: any }) {
  return {
    tabPress: (e: { preventDefault: () => void }) => {
      if (!navigation.isFocused()) return;
      const state = navigation.getState();
      const inner = state.routes[state.index]?.state;
      if (inner && inner.routes && inner.routes.length > 1) {
        e.preventDefault();
        navigation.dispatch({ type: 'POP_TO_TOP', target: inner.key });
      }
    },
  };
}

export default function AppLayout() {

  const C = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.paper },
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.ink3,
        tabBarStyle: { backgroundColor: C.card, borderTopWidth: 2, borderTopColor: C.ink, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontFamily: F.note, fontSize: 12, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }}
        listeners={popToRootOnRetap}
      />
      <Tabs.Screen
        name="library"
        options={{ title: 'Library', tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" size={size} color={color} /> }}
        listeners={popToRootOnRetap}
      />
      <Tabs.Screen
        name="cards"
        options={{ title: 'Cards', tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" size={size} color={color} /> }}
        listeners={popToRootOnRetap}
      />
      <Tabs.Screen
        name="exams"
        options={{ title: 'Exams', tabBarIcon: ({ color, size }) => <Ionicons name="trophy-outline" size={size} color={color} /> }}
        listeners={popToRootOnRetap}
      />
      <Tabs.Screen
        name="me"
        options={{ title: 'Me', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} /> }}
        listeners={popToRootOnRetap}
      />
    </Tabs>
  );
}
