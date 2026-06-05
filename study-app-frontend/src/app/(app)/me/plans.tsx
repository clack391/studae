import { Alert, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import type { Plan } from '@/lib/types';

function cap(s?: string | null) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}

function priceLabel(p: Plan): string {
  if (!p.price_cents) return 'Free';
  return `${(p.price_cents / 100).toFixed(2)} ${p.currency.toUpperCase()}`;
}

function limit(n: number | null, noun: string): string {
  return n == null ? `Unlimited ${noun}` : `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function PlanCard({ plan, currentCode, onTrial }: { plan: Plan; currentCode?: string; onTrial: boolean }) {
  const C = useTheme();
  const isCurrent = plan.code === currentCode;
  const trialPlan = plan.code === 'basic';
  const limits = [
    limit(plan.max_documents, 'document'),
    `${plan.max_questions != null ? plan.max_questions : 'Unlimited'} question${plan.max_questions === 1 ? '' : 's'} / month`,
    `${plan.max_assessments != null ? plan.max_assessments : 'Unlimited'} assessment${plan.max_assessments === 1 ? '' : 's'} / month`,
  ];
  return (
    <Card kind={isCurrent ? 'accent' : 'soft'}>
      <Row top>
        <Col gap={4} style={{ flex: 1 }}>
          <T v="handH3">{cap(plan.name)}</T>
          <T v="mut">{plan.price_cents ? `per ${plan.billing_period ?? 'month'}` : '7-day trial'}</T>
        </Col>
        <Col gap={4} style={{ alignItems: 'flex-end' }}>
          <T v="handH3">{priceLabel(plan)}</T>
          {isCurrent ? <Badge label="Current" kind="ok" /> : trialPlan && !currentCode ? <Badge label="Trial" kind="warn" /> : null}
        </Col>
      </Row>
      <Col gap={5}>
        {limits.map((l) => (
          <Row key={l} gap={6}>
            <Ionicons name="checkmark" size={14} color={C.accent} />
            <T v="small">{l}</T>
          </Row>
        ))}
      </Col>
      {!isCurrent ? (
        <Button
          label={trialPlan ? 'Choose' : 'Upgrade'}
          kind="pri"
          size="sm"
          block
          onPress={() => Alert.alert('Coming soon', 'In-app purchase verification is on the way.')}
        />
      ) : null}
      {isCurrent && onTrial ? <T v="mut">You're on a free trial.</T> : null}
    </Card>
  );
}

export default function Plans() {
  const C = useTheme();
  const access = useQuery({ queryKey: ['access'], queryFn: () => api.meAccess() });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.plans() });

  const current = access.data?.state.plan;
  const onTrial = access.data?.state.reason === 'trial';

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Plans" />
      <Screen>
        {access.data ? (
          <Card kind="accent" flat>
            <Row>
              <Ionicons name="time-outline" size={16} color={C.accent} />
              <T v="small" style={{ flex: 1 }}>
                You're on <T v="bodyB">{cap(current ?? 'basic')}</T>
                {onTrial ? ' (free trial)' : ''}
                {access.data.state.active ? '' : ' (expired)'}
              </T>
            </Row>
          </Card>
        ) : null}

        {(plans.data?.plans ?? []).map((p) => (
          <PlanCard key={p.code} plan={p} currentCode={current} onTrial={onTrial} />
        ))}
        <T v="mut">
          In-app purchases on iOS / Android go through Apple & Google billing.
        </T>
      </Screen>
    </View>
  );
}
