import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import type { Plan } from '@/lib/types';

function cap(s?: string | null) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

function nextTier(plans: Plan[], currentCode?: string): Plan | undefined {
  // Cheap heuristic — pick a plan with a higher price than the current one.
  const sorted = [...plans].sort((a, b) => a.price_cents - b.price_cents);
  if (!currentCode) return sorted.find((p) => p.price_cents > 0) ?? sorted[0];
  const idx = sorted.findIndex((p) => p.code === currentCode);
  return idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : undefined;
}

export default function UpgradeGate() {
  const C = useTheme();
  const router = useRouter();
  const { reason, kind } = useLocalSearchParams<{ reason?: string; kind?: string }>();
  const access = useQuery({ queryKey: ['access'], queryFn: () => api.meAccess() });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.plans() });

  const current = access.data?.state.plan;
  const next = nextTier(plans.data?.plans ?? [], current);
  const onTrial = access.data?.state.reason === 'trial' || access.data?.state.reason === 'trial_expired';
  const expired = access.data && !access.data.state.active;

  const headline = expired
    ? onTrial ? 'Your trial has ended' : 'Your subscription has lapsed'
    : kind === 'document' ? 'Document limit reached'
    : kind === 'assessment' ? 'Assessment limit reached'
    : kind === 'question' ? 'Question limit reached'
    : 'Plan limit reached';

  const sub = reason
    ? String(reason)
    : 'Upgrade to keep studying without pausing.';

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="" />
      <Screen style={{ alignItems: 'center' }}>
        <View style={{ height: 16 }} />
        <Ionicons name="trophy-outline" size={48} color={C.accent} />
        <T v="handH2" style={{ textAlign: 'center', marginTop: 8 }}>{headline}</T>
        <T style={{ textAlign: 'center', paddingHorizontal: 14 }}>{sub}</T>

        {next ? (
          <Card kind="accent" style={{ width: '100%' }}>
            <Row top>
              <Col gap={4} style={{ flex: 1 }}>
                <T v="handH3">{cap(next.name)}</T>
                <T v="mut">
                  {next.max_documents == null ? 'Unlimited documents' : `${next.max_documents} documents`}
                  {' · '}
                  {next.max_questions == null ? 'Unlimited questions' : `${next.max_questions} questions / mo`}
                </T>
              </Col>
              <T v="handH3">
                {next.price_cents ? `$${(next.price_cents / 100).toFixed(2)}` : 'Free'}
              </T>
            </Row>
            <Button
              label={`Upgrade to ${cap(next.name)}`}
              kind="pri"
              block
              onPress={() => router.replace('/(app)/me/plans')}
            />
          </Card>
        ) : null}

        <Pressable onPress={() => router.back()}>
          <T v="bodyB" style={{ marginTop: 6 }}>Maybe later</T>
        </Pressable>
      </Screen>
    </View>
  );
}
