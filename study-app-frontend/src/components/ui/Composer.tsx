import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { bodyFont, useReadingFont, useTextScale, useTheme } from '@/lib/theme';
export function Composer({
  onSend, onPhoto, placeholder = 'Ask about your material…', disabled, sending,
}: {
  onSend: (text: string) => void;
  onPhoto?: () => void;
  placeholder?: string;
  // Hard-disable both input and send (e.g. before the session exists).
  disabled?: boolean;
  // Soft-disable: text field stays editable so the user can draft the
  // next question while the previous one is still answering, but the send
  // button is blocked to prevent stacking requests.
  sending?: boolean;
}) {
  const C = useTheme();
  const scale = useTextScale();
  const rf = useReadingFont();
  const [text, setText] = useState('');
  const sendBlocked = !!disabled || !!sending;

  function submit() {
    const t = text.trim();
    if (!t || sendBlocked) return;
    setText('');
    onSend(t);
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        backgroundColor: C.card,
        borderTopWidth: 2,
        borderColor: C.ink,
        padding: 10,
      }}
    >
      {onPhoto ? (
        <Pressable
          onPress={onPhoto}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add photo"
        >
          <Ionicons name="camera-outline" size={22} color={C.ink2} />
        </Pressable>
      ) : null}
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={C.ink3}
        onSubmitEditing={submit}
        returnKeyType="send"
        editable={!disabled}
        style={{
          flex: 1,
          borderWidth: 2,
          borderColor: C.line,
          borderRadius: 20,
          paddingVertical: 9,
          paddingHorizontal: 14,
          fontSize: Math.round(13 * scale),
          color: C.ink,
          fontFamily: bodyFont(rf),
        }}
      />
      <Pressable
        onPress={submit}
        disabled={sendBlocked}
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: sendBlocked }}
        style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: C.accentD,
          alignItems: 'center', justifyContent: 'center',
          opacity: sendBlocked ? 0.5 : 1,
        }}
      >
        <Ionicons name="arrow-forward" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}
