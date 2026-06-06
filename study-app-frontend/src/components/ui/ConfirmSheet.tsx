import { Modal, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { T } from './T';

type Tone = 'danger' | 'neutral';

/**
 * Premium-styled confirmation bottom sheet. Replaces React Native's
 * `Alert.alert` for destructive / important actions where the system
 * Material dialog feels off-brand. Slides up from the bottom over a
 * dimmed scrim, ink-bordered with hand-styled title.
 *
 * - `tone: 'danger'`   → red confirm button + warning icon. Use for
 *                        sign-out, delete, clear data, anything irreversible.
 * - `tone: 'neutral'`  → ink confirm button. Use for plain confirmations.
 *
 * The confirm button shows `confirmLabel`; the dismiss button shows
 * `cancelLabel` (default 'Cancel'). Both Pressables close the sheet
 * before invoking their callbacks.
 */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'neutral',
  // When true, only renders the confirm button (no Cancel) — used for
  // simple "info" sheets like the notifications bell that just need an
  // acknowledgement, not a choice.
  singleAction = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: Tone;
  singleAction?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const C = useTheme();
  const danger = tone === 'danger';
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.55)',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={() => {/* swallow taps inside sheet */}}
          style={{
            backgroundColor: C.card,
            borderTopWidth: 2,
            borderLeftWidth: 2,
            borderRightWidth: 2,
            borderColor: C.ink,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingHorizontal: 16,
            paddingTop: 18,
            paddingBottom: 28,
            gap: 14,
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 44,
                height: 5,
                borderRadius: 3,
                backgroundColor: C.line,
                marginBottom: 12,
              }}
            />
          </View>
          {danger ? (
            <View
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 4,
                paddingHorizontal: 10,
                borderRadius: 999,
                backgroundColor: C.errSoft,
              }}
            >
              <Ionicons name="warning" size={14} color={C.err} />
              <T style={{ color: C.err, fontSize: 12, fontWeight: '700' }}>
                Irreversible
              </T>
            </View>
          ) : null}
          <T v="handH2">{title}</T>
          <T v="small">{message}</T>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            {singleAction ? null : (
              <Pressable
                onPress={onCancel}
                style={{
                  flex: 1,
                  paddingVertical: 13,
                  alignItems: 'center',
                  borderRadius: 14,
                  borderWidth: 1.6,
                  borderColor: C.line,
                  backgroundColor: 'transparent',
                }}
              >
                <T style={{ color: C.ink, fontWeight: '700' }}>{cancelLabel}</T>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                onCancel();
                onConfirm();
              }}
              style={{
                flex: 1,
                paddingVertical: 13,
                alignItems: 'center',
                borderRadius: 14,
                backgroundColor: danger ? C.err : C.ink,
              }}
            >
              <T style={{ color: C.card, fontWeight: '700' }}>{confirmLabel}</T>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
