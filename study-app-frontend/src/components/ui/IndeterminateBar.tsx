import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';
/**
 * Sweeping bar — a 40%-wide accent block translates across the track
 * indefinitely. Drops in wherever a real progress value is unknown
 * (waiting on a Claude call, before a lesson topic has loaded, etc.)
 */
export function IndeterminateBar({ height = 9 }: { height?: number }) {
  const C = useTheme();
  const x = useSharedValue(-50);
  useEffect(() => {
    x.value = withRepeat(
      withTiming(150, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
  }, [x]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: `${x.value}%` }],
  }));
  return (
    <View
      style={{
        height,
        borderRadius: 6,
        backgroundColor: C.card2,
        borderWidth: 1.6,
        borderColor: C.line,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: '40%',
            backgroundColor: C.accent,
            borderRadius: 6,
          },
          style,
        ]}
      />
    </View>
  );
}
