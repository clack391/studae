import { View, ViewProps, ViewStyle } from 'react-native';
import { R, useTheme } from '@/lib/theme';
type Kind = 'plain' | 'soft' | 'fill' | 'accent';

export function Card({ kind = 'plain', flat, style, children, ...rest }: ViewProps & { kind?: Kind; flat?: boolean }) {

  const C = useTheme();
  const base: ViewStyle = {
    backgroundColor: C.card,
    borderColor: C.ink,
    borderWidth: 2,
    borderRadius: R.xl,
    padding: 13,
    gap: 9,
  };
  if (kind === 'soft') base.borderColor = C.line;
  else if (kind === 'fill') base.backgroundColor = C.card2;
  else if (kind === 'accent') { base.backgroundColor = C.accentSoft; base.borderColor = C.accent; }
  if (flat) (base as any).shadowOpacity = 0;
  return <View {...rest} style={[base, style]}>{children}</View>;
}

export function Row({ between, top, wrap, gap = 10, style, children, ...rest }: ViewProps & { between?: boolean; top?: boolean; wrap?: boolean; gap?: number }) {
  return (
    <View
      {...rest}
      style={[
        {
          flexDirection: 'row',
          alignItems: top ? 'flex-start' : 'center',
          gap,
          ...(between && { justifyContent: 'space-between' }),
          ...(wrap && { flexWrap: 'wrap' }),
        } as ViewStyle,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Col({ style, children, gap = 10, ...rest }: ViewProps & { gap?: number }) {
  return <View {...rest} style={[{ flexDirection: 'column', gap }, style]}>{children}</View>;
}

export function Divider() {

  const C = useTheme();
  return <View style={{ borderTopWidth: 1.6, borderColor: C.line, borderStyle: 'dashed', marginVertical: 3 }} />;
}
