import { ReactNode } from 'react';
import { Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Row } from '@/components/ui/Card';
import { T } from '@/components/ui/T';
import { useTheme } from '@/lib/theme';

// Shared photo-screen pieces, deduped from learn/photo.tsx and
// test/photo-answer.tsx. Look and behaviour are preserved verbatim: same
// heights (220 preview / 180 placeholder), borderRadius 12, 2px C.line border,
// and the same preview-vs-placeholder conditional.

// Renders the captured image when `imageUri` is set, otherwise an empty
// placeholder prompting the student to snap/pick a photo. `placeholder` is the
// caption shown inside the empty state (it differs per screen).
export function PhotoPreview({ imageUri, placeholder }: { imageUri?: string | null; placeholder: string }) {
  const C = useTheme();
  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={{ width: '100%', height: 220, borderRadius: 12, borderWidth: 2, borderColor: C.line }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={{
        height: 180, borderRadius: 12, borderWidth: 2, borderColor: C.line,
        alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2, gap: 8,
      }}
    >
      <Ionicons name="image-outline" size={40} color={C.ink3} />
      <T v="small">{placeholder}</T>
    </View>
  );
}

// The "what we read from your photo" read-back card with its inner
// borderRadius-8 box. `hint` is the footer copy (differs per screen) and
// `children` lets a screen append trailing actions (e.g. a "Back to question"
// button) inside the card.
export function ReadBackCard({ text, hint, children }: { text: string; hint: string; children?: ReactNode }) {
  const C = useTheme();
  return (
    <Card kind="accent" flat>
      <Row>
        <Ionicons name="eye-outline" size={15} color={C.accent} />
        <T v="bodyB">What we read from your photo</T>
      </Row>
      <View style={{ backgroundColor: C.card, borderWidth: 1.5, borderColor: C.line, borderRadius: 8, padding: 8 }}>
        <T>{text}</T>
      </View>
      <T v="mut">{hint}</T>
      {children}
    </Card>
  );
}
