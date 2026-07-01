// Author: Adarsh Singh | Roll No: IC2025006
import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';

export default function TabLayout() {
  return (
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
  );
}
