import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { T } from './T';
import { listCuratedVoices, previewVoice, type CuratedVoice } from '@/lib/tts';

/**
 * Bottom-sheet picker for the device's text-to-speech voices. Same scrim +
 * ink-bordered sheet styling as ConfirmSheet. Tapping a voice selects it AND
 * speaks a short sample so the user hears it immediately; the sheet stays open
 * so they can try several. "Device default" clears the choice.
 *
 * Voice ids are device-specific, so the list comes from
 * Speech.getAvailableVoicesAsync() at open time. We show English voices
 * (the app's content language); each row is name + locale.
 */
export function VoicePicker({
  visible,
  currentVoiceId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  currentVoiceId: string | null;
  onSelect: (v: { id: string; name: string } | null) => void;
  onClose: () => void;
}) {
  const C = useTheme();
  const [voices, setVoices] = useState<CuratedVoice[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setVoices(null);
    listCuratedVoices().then((list) => { if (alive) setVoices(list); });
    return () => { alive = false; };
  }, [visible]);

  function VoiceRow({ id, name, sub }: { id: string | null; name: string; sub?: string }) {
    const sel = (currentVoiceId ?? null) === id;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: sel }}
        accessibilityLabel={name}
        onPress={() => {
          onSelect(id ? { id, name } : null);
          previewVoice(id ?? undefined);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: sel ? C.accent : C.line,
          backgroundColor: sel ? C.accentSoft : C.card,
          marginBottom: 8,
          minHeight: 56,
        }}
      >
        <Ionicons
          name={sel ? 'volume-high' : 'volume-medium-outline'}
          size={18}
          color={sel ? C.accentInk : C.ink2}
        />
        <View style={{ flex: 1 }}>
          <T v="bodyB" style={{ color: sel ? C.accentInk : C.ink }} numberOfLines={1}>{name}</T>
          {sub ? <T v="mut">{sub}</T> : null}
        </View>
        {sel ? <Ionicons name="checkmark-circle" size={20} color={C.accent} /> : null}
      </Pressable>
    );
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {/* swallow taps inside the sheet */}}
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
            gap: 12,
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 6 }} />
          </View>
          <T v="handH2">Read-aloud voice</T>
          <T v="small">Tap a voice to hear it. Your choice is used whenever lessons are read aloud.</T>

          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingTop: 4 }}>
            <VoiceRow id={null} name="Device default" sub="Your phone's standard voice" />
            {voices === null ? (
              <T v="mut" style={{ paddingVertical: 16, textAlign: 'center' }}>Loading voices…</T>
            ) : voices.length === 0 ? (
              <T v="mut" style={{ paddingVertical: 16, textAlign: 'center' }}>
                No natural voices found on this device. Add more in your phone's
                accessibility / spoken-content settings.
              </T>
            ) : (
              voices.map((v) => (
                <VoiceRow
                  key={v.id}
                  id={v.id}
                  name={v.name}
                  sub={v.gender ? `${v.accent} · ${v.gender}` : v.accent}
                />
              ))
            )}
          </ScrollView>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done"
            style={{
              paddingVertical: 13,
              alignItems: 'center',
              borderRadius: 14,
              backgroundColor: C.ink,
            }}
          >
            <T style={{ color: C.card, fontWeight: '700' }}>Done</T>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
