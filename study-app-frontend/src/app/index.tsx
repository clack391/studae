import { Redirect } from 'expo-router';
import { Loading, useAuth } from '@/components/AuthProvider';

export default function Index() {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  return <Redirect href={session ? '/(app)/home' : '/(auth)/sign-in'} />;
}
