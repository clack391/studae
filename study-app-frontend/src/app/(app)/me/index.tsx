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
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { F, useTheme, useThemeMode, type ThemeMode } from '@/lib/theme';
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

function LevelToggle({ value, onChange }: { value: Level; onChange: (v: Level) => void }) {
  const C = useTheme();
  const opts: Level[] = ['novice', 'amateur', 'professional'];
  return (
    <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: C.ink, borderRadius: 11, overflow: 'hidden' }}>
      {opts.map((opt, i) => {
        const on = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              flex: 1,
              paddingVertical: 8,
              backgroundColor: on ? C.ink : 'transparent',
              borderRightWidth: i === opts.length - 1 ? 0 : 2,
              borderColor: C.ink,
              alignItems: 'center',
            }}
          >
            <T style={{ fontFamily: F.hand, fontSize: 17, color: on ? C.card : C.ink2 }}>{opt === 'professional' ? 'Pro' : cap(opt)}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

function ThemeSegmented() {
  const C = useTheme();
  const { mode, setMode } = useThemeMode();
  const opts: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  return (
    <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: C.ink, borderRadius: 11, overflow: 'hidden' }}>
      {opts.map((opt, i) => {
        const on = opt.value === mode;
        return (
          <Pressable
            key={opt.value}
            onPress={() => setMode(opt.value)}
            style={{
              flex: 1,
              paddingVertical: 8,
              backgroundColor: on ? C.ink : 'transparent',
              borderRightWidth: i === opts.length - 1 ? 0 : 2,
              borderColor: C.ink,
              alignItems: 'center',
            }}
          >
            <T style={{ fontFamily: F.hand, fontSize: 17, color: on ? C.card : C.ink2 }}>{opt.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

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
  const access = useQuery({ queryKey: ['access'], queryFn: () => api.meAccess() });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  useFocusEffect(useCallback(() => { access.refetch(); dash.refetch(); }, []));

  const [level, setLevel] = useState<Level>('novice');
  const [tts, setTts] = useState(false);
  useEffect(() => {
    if (dash.data) {
      setLevel(dash.data.preferred_level);
      setTts(dash.data.tts_enabled);
    }
  }, [dash.data?.preferred_level, dash.data?.tts_enabled]);

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
      Alert.alert(
        'All data cleared',
        'Your documents, lessons, flashcards, tests, and uploads are gone. Your account stays active.',
        [{ text: 'OK', onPress: () => router.replace('/(app)/home') }],
      );
    },
    onError: (e: any) => Alert.alert('Could not clear', e?.message ?? ''),
  });

  function confirmClearData() {
    Alert.alert(
      'Clear ALL your data?',
      'This removes every document you uploaded, every lesson you took, every test you generated, every flashcard, every focus area, and every file in storage. Your account and email stay. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear everything',
          style: 'destructive',
          onPress: () => {
            // Second confirmation — destructive enough to deserve two taps.
            Alert.alert(
              'Are you absolutely sure?',
              'There is no undo. Type-confirm by tapping Clear again.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear', style: 'destructive', onPress: () => clearData.mutate() },
              ],
            );
          },
        },
      ],
    );
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
            <View
              style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.accentSoft, borderWidth: 2, borderColor: C.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <T style={{ fontFamily: F.hand, fontSize: 24, color: C.accentInk }}>{name[0]?.toUpperCase() ?? 'M'}</T>
            </View>
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
        <LevelToggle value={level} onChange={(v) => { setLevel(v); save.mutate({ preferred_level: v }); }} />
        <T v="mut">Used whenever you start a new lesson or test.</T>

        <T v="label">Appearance</T>
        <ThemeSegmented />
        <T v="mut">System follows your phone's light or dark setting.</T>

        <Card kind="soft" flat>
          <Row>
            <Col gap={2} style={{ flex: 1 }}>
              <T v="bodyB">Read aloud</T>
              <T v="mut">A speaker button reads lessons out loud</T>
            </Col>
            <TtsToggle on={tts} onChange={(v) => { setTts(v); save.mutate({ tts_enabled: v }); }} />
          </Row>
        </Card>

        <Card kind="soft" flat>
          <Row>
            <Col gap={2} style={{ flex: 1 }}>
              <T v="bodyB">Larger text</T>
              <T v="mut">Increase reading size</T>
            </Col>
            <TtsToggle on={false} onChange={() => Alert.alert('Coming soon', 'Text-size override lands in the next update.')} />
          </Row>
        </Card>

        <Pressable onPress={() => router.push('/(app)/me/plans')}>
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

        <Pressable onPress={() => supabase.auth.signOut()}>
          <Card kind="soft" flat>
            <Row>
              <Ionicons name="log-out-outline" size={18} color={C.ink2} />
              <T v="bodyB" style={{ flex: 1 }}>Sign out</T>
            </Row>
          </Card>
        </Pressable>

        <Pressable
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

        <Pressable onPress={() => router.push('/(app)/me/delete')}>
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
              <View
                style={{
                  borderWidth: 1.5,
                  borderColor: C.err,
                  borderRadius: 6,
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                }}
              >
                <T style={{ fontSize: 10, fontWeight: '800', color: C.err, letterSpacing: 0.6 }}>
                  PERMANENT
                </T>
              </View>
              <Ionicons name="chevron-forward" size={15} color={C.ink2} />
            </Row>
          </Card>
        </Pressable>
      </Screen>
    </View>
  );
}
