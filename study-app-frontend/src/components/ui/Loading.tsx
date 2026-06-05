import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { T } from './T';

export function Loading({ label = 'Loading…', size = 'small', inline }: {
  label?: string;
  size?: 'small' | 'large';
  inline?: boolean;
}) {

  const C = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: inline ? 8 : 24,
        gap: 8,
        flexDirection: inline ? 'row' : 'column',
      }}
    >
      <ActivityIndicator color={C.accent} size={size} />
      {label ? <T v="small">{label}</T> : null}
    </View>
  );
}
