import { Pressable, View } from 'react-native';
import { F, useTheme } from '@/lib/theme';
import { T } from './T';

export function MCQ({ letter, text, selected, state, onPress }: {
  letter: string;
  text: string;
  selected?: boolean;
  state?: 'correct' | 'wrong';
  onPress?: () => void;
}) {
  const C = useTheme();
  let border = C.line;
  let bg = C.card;
  let bubbleBg: string = 'transparent';
  let bubbleBorder = C.line;
  let bubbleColor = C.ink2;
  if (state === 'correct') { border = C.ok; bg = C.okSoft; bubbleBg = C.ok; bubbleBorder = C.ok; bubbleColor = '#fff'; }
  else if (state === 'wrong') { border = C.err; bg = C.errSoft; bubbleBg = C.err; bubbleBorder = C.err; bubbleColor = '#fff'; }
  else if (selected) { border = C.accent; bg = C.accentSoft; bubbleBg = C.accent; bubbleBorder = C.accent; bubbleColor = '#fff'; }
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderWidth: 2,
        borderColor: border,
        backgroundColor: bg,
        borderRadius: 11,
        padding: 11,
      }}
    >
      <View
        style={{
          width: 24, height: 24, borderRadius: 12,
          borderWidth: 2, borderColor: bubbleBorder, backgroundColor: bubbleBg,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <T style={{ fontFamily: F.hand, fontSize: 15, color: bubbleColor }}>{letter}</T>
      </View>
      <T style={{ flex: 1, fontSize: 13, color: C.ink, lineHeight: 17 }}>{text}</T>
    </Pressable>
  );
}
