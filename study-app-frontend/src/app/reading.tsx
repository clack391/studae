import { View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { T } from '@/components/ui/T';
import { MD } from '@/components/ui/MD';
import { ReadingFont, TextSize, useTheme, useThemeMode } from '@/lib/theme';

const SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'xl', label: 'XL' },
];

const FONT_OPTIONS: { value: ReadingFont; label: string }[] = [
  { value: 'system', label: 'Default' },
  { value: 'serif', label: 'Serif' },
  { value: 'legible', label: 'Legible' },
];

// Live preview: plain markdown so the chosen size + font show immediately.
const PREVIEW = [
  '## Preview heading',
  '',
  'This is how your **reading text** will look. Lessons, answers, summaries, '
    + 'and quiz questions all use this size and font.',
  '',
  '- Clear to read at any size',
  '- Headings keep the handwriting style',
].join('\n');

export default function Reading() {
  const C = useTheme();
  const { textSize, setTextSize, readingFont, setReadingFont } = useThemeMode();
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Reading text" />
      <Screen>
        <T v="label">Reading size</T>
        <Segmented value={textSize} options={SIZE_OPTIONS} onChange={setTextSize} />
        <T v="mut">Applies to all text: lessons, answers, diagrams, stats, and buttons.</T>

        <T v="label" style={{ marginTop: 18 }}>Reading font</T>
        <Segmented value={readingFont} options={FONT_OPTIONS} onChange={setReadingFont} />
        <T v="mut">
          Body text only; headings keep the handwriting style. "Legible" uses a
          font designed for easier reading.
        </T>

        <Card kind="soft" flat style={{ marginTop: 18 }}>
          <MD>{PREVIEW}</MD>
        </Card>
      </Screen>
    </View>
  );
}
