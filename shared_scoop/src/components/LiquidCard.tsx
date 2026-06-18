// Author: Adarsh Singh | Roll No: IC2025006
// LiquidCard.tsx — High-fidelity Neo-morphic wrapper pushing physics to the UI thread.
//
// Architecture:
//   - All scale transforms use useSharedValue + useAnimatedStyle → runs on the
//     UI thread at 60 FPS. Zero JS thread involvement during the gesture.
//   - expo-haptics is bridged into the worklet lifecycle via runOnJS, syncing
//     the physical click feel with the visual spring compression.
//   - The BlurView frosted-glass effect distorts whatever matrix layer sits
//     behind it in the parent ScrollView. Without those coloured orbs behind
//     the card, the blur will look like a flat grey — both layers are required.
//   - Spring config: high stiffness (300) + low damping (15) mimics heavy glass
//     bouncing on a felt surface. overshootClamping: false lets the overshoot
//     ring through for a tactile "wobble" on release.

import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';

interface LiquidCardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  intensity?: number;
}

const SPRING_CONFIG = {
  mass: 1,
  damping: 15,
  stiffness: 300,
  overshootClamping: false,
};

export default function LiquidCard({
  children,
  onPress,
  style,
  intensity = 60,
}: LiquidCardProps) {
  const scale = useSharedValue(1);

  // Bridge functions — called from the UI thread via runOnJS.
  const triggerHapticDown = () =>
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  const triggerHapticUp = () =>
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  const tapGesture = Gesture.Tap()
    .maxDuration(10000)
    .onBegin(() => {
      'worklet';
      scale.value = withSpring(0.96, SPRING_CONFIG);
      runOnJS(triggerHapticDown)();
    })
    .onTouchesUp(() => {
      'worklet';
      if (onPress) runOnJS(onPress)();
    })
    .onFinalize(() => {
      'worklet';
      scale.value = withSpring(1, SPRING_CONFIG);
      runOnJS(triggerHapticUp)();
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={tapGesture}>
      <Animated.View style={[animatedStyle, styles.container, style]}>
        <BlurView intensity={intensity} tint="dark" style={styles.blurContainer}>
          <View style={styles.glassBorder} />
          {children}
        </BlurView>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(20, 20, 30, 0.45)',
    marginVertical: 8,
  },
  blurContainer: {
    padding: 20,
  },
  glassBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderBottomColor: 'rgba(255, 255, 255, 0.02)',
    borderRightColor: 'rgba(255, 255, 255, 0.02)',
  },
});
