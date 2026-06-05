import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';
export default function AuthLayout() {
  const C = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.paper },
        animation: 'slide_from_right',
        animationDuration: 220,
      }}
    />
  );
}
