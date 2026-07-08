// Author: Adarsh Singh | Roll No: IC2025006
import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Dynamic FAB offset: device bottom inset (home indicator / nav bar) + 64px
  // (base tab bar height 49px + 15px clearance buffer).
  // Falls back to 20px on devices with no bottom inset (Android gesture-less).
  const fabBottom = (insets.bottom > 0 ? insets.bottom : 20) + 64;

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,

          // ── Active / Inactive tint ─────────────────────────────────────────
          tabBarActiveTintColor: '#34d399',
          tabBarInactiveTintColor: '#9ca3af',

          // ── Label typography ──────────────────────────────────────────────
          tabBarShowLabel: true,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginBottom: Platform.OS === 'ios' ? 0 : 4,
            letterSpacing: 0.3,
          },

          // ── Tab item alignment ─────────────────────────────────────────────
          tabBarItemStyle: {
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: 6,
          },

          // ── Container dimensions + safe areas ─────────────────────────────
          tabBarStyle: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: Platform.OS === 'ios' ? 88 : 68,
            paddingBottom: Platform.OS === 'ios' ? 24 : 8,
            paddingTop: 8,
            // Strip Android shadow
            elevation: 0,
            // Top separator
            borderTopWidth: 1,
            borderTopColor: 'rgba(255, 255, 255, 0.08)',
            // Make native bar transparent so BlurView shows through
            backgroundColor: 'transparent',
          },

          // ── Liquid Glass background ────────────────────────────────────────
          tabBarBackground: () => (
            <BlurView
              intensity={40}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ),
        }}
      >
        {/* ── Dashboard ──────────────────────────────────────────────────── */}
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Dashboard',
            tabBarLabel: 'Dashboard',
            tabBarIcon: ({ color, focused }) => (
              <Text style={{ fontSize: focused ? 22 : 20, color }}>📊</Text>
            ),
          }}
        />

        {/* ── Browse (Pools) ─────────────────────────────────────────────── */}
        <Tabs.Screen
          name="browse"
          options={{
            title: 'Pools',
            tabBarLabel: 'Pools',
            tabBarIcon: ({ color, focused }) => (
              <Text style={{ fontSize: focused ? 22 : 20, color }}>🔍</Text>
            ),
          }}
        />

        {/* ── Commitments (Pledges) ──────────────────────────────────────── */}
        <Tabs.Screen
          name="commitments"
          options={{
            title: 'Pledges',
            tabBarLabel: 'Pledges',
            tabBarIcon: ({ color, focused }) => (
              <Text style={{ fontSize: focused ? 22 : 20, color }}>🛒</Text>
            ),
          }}
        />
      </Tabs>

      {/* ── Sarvam AI Translation FAB ───────────────────────────────────────
          bottom: dynamic insets.bottom + 64 — clears tab bar on every device.
          right: 20 — right-hand primary thumb zone (replaces left: 20).
          BlurView + 1px border matches the tab bar's Liquid Glass treatment. */}
      <TouchableOpacity
        style={[styles.fab, { bottom: fabBottom, right: 20 }]}
        onPress={() => router.push('/debug/translation')}
        activeOpacity={0.82}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <BlurView intensity={40} tint="dark" style={styles.fabBlur}>
          <View style={styles.fabBorder} />
          <Text style={styles.fabIcon}>A/अ</Text>
        </BlurView>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },

  // ── Sarvam FAB (static geometry only — position injected inline from insets) ─
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    // Purple glow shadow
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 10,
  },
  fabBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  fabIcon: {
    fontSize: 14,
    fontWeight: '800',
    color: '#a78bfa',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
