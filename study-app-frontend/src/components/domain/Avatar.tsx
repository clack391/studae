import { Image, View, ViewStyle } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { F, useTheme } from '@/lib/theme';
import { T } from '@/components/ui/T';

/**
 * Shared profile avatar. Used by Home, Me, and Profile so the avatar looks
 * identical everywhere.
 *
 * `avatarUrl` is a storage KEY in the private "uploads" bucket — NOT a public
 * URL. When it's set we resolve a short signed URL via api.signedUrl(key)
 * (keyed on the avatarUrl so the cache shares across screens, like Figure.tsx)
 * and render a circular <Image> at the requested size. When it's missing (or
 * the signed-url fetch fails), we fall back to the initial-letter circle:
 * accentSoft fill, accent border, F.hand letter.
 */
export function Avatar({
  avatarUrl,
  name,
  size,
  style,
}: {
  avatarUrl?: string | null;
  name: string;
  size: number;
  style?: ViewStyle;
}) {
  const C = useTheme();

  const signed = useQuery({
    queryKey: ['signed-url', avatarUrl],
    queryFn: () => api.signedUrl(avatarUrl!),
    enabled: !!avatarUrl,
  });

  const base: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 2,
    borderColor: C.accent,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (avatarUrl && signed.data?.url) {
    return (
      <View style={[base, { backgroundColor: C.accentSoft }, style]}>
        <Image
          source={{ uri: signed.data.url }}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      </View>
    );
  }

  // Initial-letter fallback. Scale the glyph to ~46% of the circle so it
  // reads at any size (32 px header pill → 96 px profile hero).
  const letter = name?.[0]?.toUpperCase() ?? 'M';
  return (
    <View style={[base, { backgroundColor: C.accentSoft }, style]}>
      <T style={{ fontFamily: F.hand, fontSize: Math.round(size * 0.46), color: C.accentInk }}>
        {letter}
      </T>
    </View>
  );
}
