import { ScrollView, View, ViewStyle, StyleProp, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
/**
 * Screen wrapper. Top safe-area inset is OPT-IN via `safeTop` because most
 * screens have an AppBar above them that already handles the top inset.
 * Auth screens (no AppBar) pass `safeTop` to get correct status-bar clearance.
 */
export function Screen({
  children, scroll = true, style, refreshing, onRefresh, pad = true, safeTop = false,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void;
  pad?: boolean;
  safeTop?: boolean;
}) {
  const C = useTheme();
  const edges = safeTop ? (['top'] as const) : ([] as const);
  if (scroll) {
    return (
      <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: C.paper }}>
        <ScrollView
          contentContainerStyle={[{ padding: pad ? 16 : 0, paddingBottom: 32, gap: 12 }, style]}
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.accent} /> : undefined}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={[{ flex: 1, padding: pad ? 16 : 0, gap: 12 }, style]}>{children}</View>
    </SafeAreaView>
  );
}
