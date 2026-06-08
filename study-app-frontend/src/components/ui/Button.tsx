import { Pressable, ViewStyle, StyleProp, TextStyle } from 'react-native';
import { F, R, useTheme } from '@/lib/theme';
import { T } from './T';

type Kind = 'pri' | 'soft' | 'ghost' | 'dark' | 'plain';

export function Button({
  label, onPress, onPressIn, kind = 'plain', block, size = 'md', disabled, style, leftIcon,
}: {
  label: string;
  onPress?: () => void;
  onPressIn?: () => void;
  kind?: Kind;
  block?: boolean;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  leftIcon?: React.ReactNode;
}) {
  const C = useTheme();
  const dims =
    size === 'lg' ? { padV: 13, padH: 18, fs: 22, br: R.lg }
    : size === 'sm' ? { padV: 6, padH: 12, fs: 16, br: 9 }
    : { padV: 9, padH: 16, fs: 19, br: R.lg };

  const box: ViewStyle = {
    paddingVertical: dims.padV,
    paddingHorizontal: dims.padH,
    borderRadius: dims.br,
    borderWidth: 2,
    borderColor: C.ink,
    backgroundColor: C.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...(block && { alignSelf: 'stretch' }),
    ...(disabled && { opacity: 0.5 }),
  };
  let txtColor = C.ink;
  if (kind === 'pri') { box.backgroundColor = C.accentD; box.borderColor = C.ink; txtColor = '#fff'; }
  else if (kind === 'dark') { box.backgroundColor = C.ink; box.borderColor = C.ink; txtColor = C.card; }
  else if (kind === 'ghost') { box.backgroundColor = 'transparent'; box.borderStyle = 'dashed'; txtColor = C.ink2; }
  else if (kind === 'soft') { box.backgroundColor = C.accentSoft; box.borderColor = C.accent; txtColor = C.accentInk; }

  // Kalam (F.hand) needs ~1.4x line height + a little bottom padding or its
  // tall glyphs clip at the top (the same recipe the T hand variants use in
  // theme.ts). A tight lineHeight here was cutting the tops of button labels,
  // which read as the text "fading" into the fill.
  const txtStyle: TextStyle = {
    fontFamily: F.hand,
    fontSize: dims.fs,
    color: txtColor,
    lineHeight: Math.round(dims.fs * 1.4),
    paddingBottom: 2,
  };

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={disabled ? undefined : onPressIn}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [box, pressed && { opacity: 0.85 }, style]}
    >
      {leftIcon}
      <T style={txtStyle}>{label}</T>
    </Pressable>
  );
}
