import { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';
export function Skeleton({ width, height, radius, style }: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const C = useTheme();
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.85, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        {
          width: width ?? '100%',
          height: height ?? 14,
          backgroundColor: C.grey,
          borderRadius: radius ?? 4,
        },
        animStyle,
        style,
      ]}
    />
  );
}

export function DocRowSkeleton() {

  const C = useTheme();
  return (
    <View
      style={{
        backgroundColor: C.card,
        borderColor: C.line,
        borderWidth: 2,
        borderRadius: 18,
        padding: 13,
        flexDirection: 'row',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <Skeleton width={46} height={58} radius={6} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="80%" height={14} />
        <Skeleton width="50%" height={11} />
      </View>
    </View>
  );
}
