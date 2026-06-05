import { TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { F, R, useTheme } from '@/lib/theme';
import { T } from './T';

export function Field({ label, multiline, style, ...rest }: TextInputProps & { label?: string; multiline?: boolean }) {

  const C = useTheme();
  const box: ViewStyle = {
    borderWidth: 2,
    borderColor: C.line,
    borderRadius: R.md,
    paddingVertical: 11,
    paddingHorizontal: 13,
    backgroundColor: C.card,
    minHeight: multiline ? 110 : undefined,
  };
  return (
    <View style={{ width: '100%' }}>
      {label ? <T v="label">{label}</T> : null}
      <TextInput
        placeholderTextColor={C.ink3}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        {...rest}
        style={[box, { fontSize: 13, color: C.ink, fontFamily: F.note }, style]}
      />
    </View>
  );
}
