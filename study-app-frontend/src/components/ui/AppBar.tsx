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

// Cap titles at ~22 characters with an ellipsis. We do this in JS instead
// of using <Text numberOfLines={1}> because numberOfLines forces Android
// onto a text-rendering path that ignores Kalam's font padding and clips
// the top of capital letters (P / T / S). Without numberOfLines, the
// glyphs render fully. The cap keeps long titles like "Pictorial Guide
// of Pest and Disease Identification and Management" from wrapping to a
// second line and breaking the AppBar height.
const TITLE_MAX = 22;
function truncateTitle(s: string): string {
  if (s.length <= TITLE_MAX) return s;
  return s.slice(0, TITLE_MAX - 1).trimEnd() + '…';
}

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

        {/* Centered title slot. The brand wordmark is short enough to use
            alignItems: 'center' so the dot accent sits flush. Document
            titles can be very long ("Pictorial Guide of Pest and Disease
            …"), so the title branch fills the slot's width and lets
            Text's own truncation handle overflow. Without width: '100%'
            the Text would shrink-wrap to its full natural width and spill
            into the back-button and right-icon zones. */}
        <View style={{ flex: 1, overflow: 'visible', flexDirection: 'row', justifyContent: 'center' }}>
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
              style={[
                {
                  fontFamily: F.hand,
                  fontSize: 22,
                  lineHeight: 30,
                  paddingBottom: 2,
                  color: C.ink,
                  letterSpacing: 0.2,
                  textAlign: 'center',
                  width: '100%',
                },
                titleWebOverflow,
              ]}
            >
              {truncateTitle(title ?? '')}
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
