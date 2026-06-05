import { Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { F, useTheme } from '@/lib/theme';
import { T } from './T';

// Both sides reserve the same width so the centered title sits at the true
// screen middle independent of the right side's content (bell, avatar, etc).
// 80 fits a single IconButton + a 32 px avatar pill side by side. If a page
// stuffs more into `right`, bump this.
const SIDE_WIDTH = 80;

// On web, numberOfLines compiles to -webkit-line-clamp + overflow:hidden,
// which clips descenders. Use CSS text-overflow:ellipsis instead.
const titleWebOverflow = Platform.OS === 'web'
  ? ({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', width: '100%', textAlign: 'center' } as any)
  : null;

export function AppBar({ title, back, onBack, right, brand }: {
  title?: string;
  back?: boolean;
  // Optional custom back action. When omitted, falls back to router.back().
  // Useful when a screen is reachable from multiple entry points and you
  // want the back arrow to always land on a specific place (e.g. library
  // detail → library list regardless of how the user got here).
  onBack?: () => void;
  right?: React.ReactNode;
  brand?: boolean;
}) {
  const C = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: C.paper, overflow: 'visible' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 14,
          paddingTop: 8,
          paddingBottom: 4,
          overflow: 'visible',
        }}
      >
        {/* Left slot — fixed width, matched to right slot for true centering. */}
        <View style={{ width: SIDE_WIDTH, flexDirection: 'row', alignItems: 'center' }}>
          {back ? (
            <Pressable onPress={onBack ?? (() => router.back())} hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color={C.ink} />
            </Pressable>
          ) : null}
        </View>

        {/* Centered title — natural-flow Caveat. No fixed height — the text
            sizes itself, so Android can't clip it against a too-small box.
            Generous lineHeight + paddingBottom let descenders breathe. */}
        <View style={{ flex: 1, alignItems: 'center', overflow: 'visible' }}>
          {brand ? (
            <T
              style={{
                fontFamily: F.hand,
                fontSize: 26,
                lineHeight: 36,
                paddingBottom: 2,
                color: C.ink,
                letterSpacing: 0.2,
                textAlign: 'center',
              }}
            >
              Studae<T style={{ fontFamily: F.hand, color: C.accent }}>.</T>
            </T>
          ) : (
            <T
              numberOfLines={Platform.OS === 'web' ? undefined : 1}
              ellipsizeMode="tail"
              style={[
                {
                  fontFamily: F.hand,
                  fontSize: 22,
                  lineHeight: 30,
                  paddingBottom: 2,
                  color: C.ink,
                  letterSpacing: 0.2,
                  textAlign: 'center',
                },
                titleWebOverflow,
              ]}
            >
              {title ?? ''}
            </T>
          )}
        </View>

        {/* Right slot — same fixed width as left. Content (bell + avatar, etc)
            right-aligns within it. */}
        <View style={{ width: SIDE_WIDTH, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
          {right ?? null}
        </View>
      </View>
    </SafeAreaView>
  );
}

export function IconButton({ name, onPress }: { name: keyof typeof Ionicons.glyphMap; onPress?: () => void }) {
  const C = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} style={{ padding: 5 }}>
      <Ionicons name={name} size={20} color={C.ink} />
    </Pressable>
  );
}
