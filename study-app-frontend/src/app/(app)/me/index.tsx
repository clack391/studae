import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row, Divider } from '@/components/ui/Card';
import { Bar } from '@/components/ui/Bar';
import { Badge } from '@/components/ui/Badge';
import { Segmented } from '@/components/ui/Segmented';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { VoicePicker } from '@/components/ui/VoicePicker';
import { T } from '@/components/ui/T';
import { Avatar } from '@/components/domain/Avatar';
import { api } from '@/lib/api';
import { getTtsVoice, setTtsVoice } from '@/lib/tts';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { READING_FONT_LABEL, TEXT_SIZE_LABEL, useTheme, useThemeMode, type ThemeMode } from '@/lib/theme';
import type { Level } from '@/lib/types';

function cap(s?: string | null) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}

function UsageRow({ label, used, limit, color }: { label: string; used: number; limit: number | null; color?: string }) {
  const C = useTheme();
  const unlimited = limit == null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <Col gap={6}>
      <Row between>
        <T v="bodyB">{label}</T>
        <T v="small">{used} / {unlimited ? '∞' : limit}</T>
      </Row>
      {unlimited ? null : <Bar pct={pct} color={color} />}
    </Col>
  );
}

const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: 'novice', label: cap('novice') },
  { value: 'amateur', label: cap('amateur') },
  { value: 'professional', label: 'Pro' },
];

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function TtsToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const C = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!on)}
      style={{
        width: 42, height: 24, borderRadius: 14, borderWidth: 2,
        borderColor: on ? C.accent : C.line,
        backgroundColor: on ? C.accentSoft : C.card2,
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 17, height: 17, borderRadius: 9,
          backgroundColor: on ? C.accent : C.ink2,
          position: 'absolute', left: on ? 21 : 2,
        }}
      />
    </Pressable>
  );
}

export default function Me() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { mode, setMode, textSize, readingFont } = useThemeMode();
  const access = useQuery({ queryKey: ['access'], queryFn: () => api.meAccess() });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  useFocusEffect(useCallback(() => { access.refetch(); dash.refetch(); }, []));

  const [level, setLevel] = useState<Level>('novice');
  const [tts, setTts] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voice, setVoice] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { getTtsVoice().then(setVoice); }, []);
  useEffect(() => {
    if (dash.data) {
      setLevel(dash.data.preferred_level);
      setTts(dash.data.tts_enabled);
    }
  }, [dash.data?.preferred_level, dash.data?.tts_enabled]);

  // Two-step destructive confirmations, both rendered via the custom
  // ConfirmSheet so they stay on-brand instead of falling back to the
  // OS Material Alert dialog. Declared before the mutations so the
  // mutation callbacks can safely capture the setters in their closures.
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [clearStep1Open, setClearStep1Open] = useState(false);
  const [clearStep2Open, setClearStep2Open] = useState(false);
  const [clearDoneOpen, setClearDoneOpen] = useState(false);
  const [clearErrorOpen, setClearErrorOpen] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { preferred_level?: Level; tts_enabled?: boolean }) => api.updateSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
    onError: (e: any) => Alert.alert('Could not save', e?.message ?? ''),
  });

  const clearData = useMutation({
    mutationFn: () => api.clearMyData(),
    onSuccess: () => {
      // Drop every cached query so Home/Library/Cards/Exams re-fetch empty
      // state instead of showing stale rows.
      qc.clear();
      setClearDoneOpen(true);
    },
    onError: (e: any) =>
      setClearErrorOpen(e?.message?.trim() || 'Something went wrong on our end. Please try again in a moment.'),
  });

  function confirmClearData() {
    setClearStep1Open(true);
  }

  const name = dash.data?.name ?? (session?.user?.user_metadata as any)?.full_name ?? 'You';
  const email = session?.user?.email ?? '';
  const a = access.data;
  const planName = a?.state.plan ? cap(a.state.plan) : '';
  const onTrial = a?.state.reason === 'trial';
  const expired = a && !a.state.active;

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar title="Me" />
      <Screen refreshing={access.isRefetching} onRefresh={() => { access.refetch(); dash.refetch(); }}>
        <Card kind="soft">
          <Row>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
              hitSlop={6}
              onPress={() => router.push('/profile')}
            >
              <Avatar avatarUrl={dash.data?.avatar_url} name={name} size={52} />
            </Pressable>
            <Col gap={4} style={{ flex: 1 }}>
              <T v="handH3" numberOfLines={1}>{name}</T>
              <T v="mut" numberOfLines={1}>{email}</T>
            </Col>
            {planName ? <Badge label={planName} kind={expired ? 'err' : 'exam'} /> : null}
          </Row>
        </Card>

        {a ? (
          <Card kind="soft">
            <UsageRow label="Questions this month" used={a.usage.questions} limit={a.limits.questions} />
            <Divider />
            <UsageRow label="Assessments this month" used={a.usage.assessments} limit={a.limits.assessments} color={C.warn} />
            {onTrial ? <T v="mut">You're on a free trial.</T> : null}
            {expired ? <T v="mut" style={{ color: C.err }}>Your {a.state.reason === 'trial_expired' ? 'trial' : 'subscription'} has ended.</T> : null}
          </Card>
        ) : null}

        <T v="label">Default teaching level</T>
        <Segmented
          value={level}
          options={LEVEL_OPTIONS}
          onChange={(v) => { setLevel(v); save.mutate({ preferred_level: v }); }}
        />
        <T v="mut">Used whenever you start a new lesson or test.</T>

        <T v="label">Appearance</T>
        <Segmented value={mode} options={THEME_OPTIONS} onChange={setMode} />
        <T v="mut">System follows your phone's light or dark setting.</T>

        <Card kind="soft" flat>
          <Row>
            <Pressable
              style={{ flex: 1 }}
              accessibilityRole="button"
              accessibilityLabel="Read-aloud voice"
              onPress={() => setVoiceOpen(true)}
            >
              <Col gap={2}>
                <Row gap={6}>
                  <T v="bodyB">Read aloud</T>
                  <Ionicons name="chevron-forward" size={14} color={C.ink3} />
                </Row>
                <T v="mut">{voice ? `Voice: ${voice.name}` : 'Tap to choose a voice'}</T>
              </Col>
            </Pressable>
            <TtsToggle on={tts} onChange={(v) => { setTts(v); save.mutate({ tts_enabled: v }); }} />
          </Row>
        </Card>

        <Card kind="soft" flat>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reading text size and font"
            onPress={() => router.push('/reading')}
          >
            <Row>
              <Col gap={2} style={{ flex: 1 }}>
                <Row gap={6}>
                  <T v="bodyB">Reading text</T>
                  <Ionicons name="chevron-forward" size={14} color={C.ink3} />
                </Row>
                <T v="mut">{TEXT_SIZE_LABEL[textSize]} · {READING_FONT_LABEL[readingFont]} font</T>
              </Col>
            </Row>
          </Pressable>
        </Card>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Subscription & plans"
          onPress={() => router.push('/(app)/me/plans')}
        >
          <Card kind="soft" flat>
            <Row>
              <Ionicons name="trophy-outline" size={18} color={C.ink2} />
              <T v="bodyB" style={{ flex: 1 }}>Subscription & plans</T>
              {expired
                ? <Badge label="Renew" kind="err" />
                : a?.state.plan !== 'pro'
                  ? <Badge label="Upgrade" kind="out" />
                  : null}
              <Ionicons name="chevron-forward" size={15} color={C.ink2} />
            </Row>
          </Card>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Study reminders"
          onPress={() => Alert.alert('Coming soon', 'Local study reminders land in the next update.')}
        >
          <Card kind="soft" flat>
            <Row>
              <Ionicons name="notifications-outline" size={18} color={C.ink2} />
              <T v="bodyB" style={{ flex: 1 }}>Study reminders</T>
              <T v="mut">off</T>
              <Ionicons name="chevron-forward" size={15} color={C.ink2} />
            </Row>
          </Card>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={() => setSignOutOpen(true)}
        >
          <Card kind="soft" flat>
            <Row>
              <Ionicons name="log-out-outline" size={18} color={C.ink2} />
              <T v="bodyB" style={{ flex: 1 }}>Sign out</T>
            </Row>
          </Card>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all my data"
          onPress={confirmClearData}
          disabled={clearData.isPending}
        >
          <Card kind="soft" flat style={{ borderColor: C.err }}>
            <Row>
              <Ionicons name="trash-bin-outline" size={18} color={C.err} />
              <T v="bodyB" style={{ flex: 1, color: C.err }}>
                {clearData.isPending ? 'Clearing…' : 'Clear all my data'}
              </T>
            </Row>
          </Card>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete account"
          onPress={() => router.push('/(app)/me/delete')}
        >
          {/* Blends with the other settings rows (same soft card surface),
              with a heavier ink border to mark it as a weightier action and
              a red icon + PERMANENT chip as the only color signals. */}
          <Card
            kind="soft"
            flat
            style={{ borderColor: C.ink, borderWidth: 2 }}
          >
            <Row>
              <Ionicons name="person-remove-outline" size={18} color={C.err} />
              <T v="bodyB" style={{ flex: 1 }}>Delete account</T>
              <Badge label="Permanent" kind="err" />
              <Ionicons name="chevron-forward" size={15} color={C.ink2} />
            </Row>
          </Card>
        </Pressable>
      </Screen>

      <ConfirmSheet
        visible={signOutOpen}
        tone="neutral"
        title="Sign out?"
        message="You will need to sign back in to use the app."
        confirmLabel="Sign out"
        onConfirm={() => supabase.auth.signOut()}
        onCancel={() => setSignOutOpen(false)}
      />

      <ConfirmSheet
        visible={clearStep1Open}
        tone="danger"
        title="Clear ALL your data?"
        message="This removes every document you uploaded, every lesson you took, every test you generated, every flashcard, every focus area, and every file in storage. Your account and email stay. This cannot be undone."
        confirmLabel="Clear everything"
        onConfirm={() => setClearStep2Open(true)}
        onCancel={() => setClearStep1Open(false)}
      />

      <ConfirmSheet
        visible={clearStep2Open}
        tone="danger"
        title="Are you absolutely sure?"
        message="There is no undo. Tap Clear once more to wipe everything."
        confirmLabel="Clear"
        onConfirm={() => clearData.mutate()}
        onCancel={() => setClearStep2Open(false)}
      />

      <ConfirmSheet
        visible={clearDoneOpen}
        tone="neutral"
        singleAction
        title="All data cleared"
        message="Your documents, lessons, flashcards, tests, and uploads are gone. Your account stays active."
        confirmLabel="OK"
        onConfirm={() => router.replace('/(app)/home')}
        onCancel={() => setClearDoneOpen(false)}
      />

      <ConfirmSheet
        visible={clearErrorOpen !== null}
        tone="neutral"
        singleAction
        title="We could not clear your data"
        message={clearErrorOpen ?? ''}
        confirmLabel="OK"
        onConfirm={() => setClearErrorOpen(null)}
        onCancel={() => setClearErrorOpen(null)}
      />

      <VoicePicker
        visible={voiceOpen}
        currentVoiceId={voice?.id ?? null}
        onSelect={(v) => { setVoice(v); setTtsVoice(v); }}
        onClose={() => setVoiceOpen(false)}
      />
    </View>
  );
}
