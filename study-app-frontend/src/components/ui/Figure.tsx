import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { T } from './T';

/**
 * Render a figure extracted from a PDF. The backend stores the image in a
 * private Supabase Storage bucket, so we first ask the backend for a short
 * signed URL, then load it. Aspect ratio is inferred from the loaded
 * image dimensions so portrait diagrams don't get squashed.
 */
export function Figure({ path, caption }: { path: string; caption?: string }) {
  const C = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [aspect, setAspect] = useState<number>(1.4);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.signedUrl(path)
      .then((r) => { if (alive) setUrl(r.url); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [path]);

  useEffect(() => {
    if (!url) return;
    Image.getSize(url, (w, h) => { if (w && h) setAspect(w / h); }, () => {});
  }, [url]);

  if (failed) return null;

  return (
    <View
      style={{
        borderWidth: 1.6,
        borderColor: C.line,
        borderRadius: 11,
        overflow: 'hidden',
        backgroundColor: C.card,
      }}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={{ width: '100%', aspectRatio: aspect }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={{ aspectRatio: 1.4, alignItems: 'center', justifyContent: 'center' }}>
          <T v="mut">loading figure…</T>
        </View>
      )}
      {caption ? (
        <View style={{ padding: 9, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.card2 }}>
          <T v="small">{caption}</T>
        </View>
      ) : null}
    </View>
  );
}
