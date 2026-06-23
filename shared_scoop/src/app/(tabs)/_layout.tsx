// Author: Adarsh Singh | Roll No: IC2025006
import React from 'react';
import { Tabs } from 'expo-router';
import { Text, Platform } from 'react-native';
import { BlurView } from 'expo-blur';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ 
      headerShown: false,
      tabBarShowLabel: true,
      tabBarActiveTintColor: '#84cc16',
      tabBarInactiveTintColor: '#6b7280',
      tabBarStyle: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 34 : 20,
        left: 20,
        right: 20,
        elevation: 0,
        height: 64,
        borderRadius: 32,
        borderTopWidth: 0,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingBottom: 0
      },
      tabBarItemStyle: {
        paddingTop: Platform.OS === 'ios' ? 12 : 0
      },
      tabBarBackground: () => (
        <BlurView 
          tint="dark" 
          intensity={60} 
          style={{ flex: 1, borderRadius: 32, overflow: 'hidden' }} 
        />
      ),
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '600',
        marginBottom: 8,
      },
      tabBarIconStyle: {
        marginTop: 4,
      }
    }}>
      <Tabs.Screen 
        name="dashboard" 
        options={{ 
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📊</Text>
        }} 
      />
      <Tabs.Screen 
        name="browse" 
        options={{ 
          title: 'Browse',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🔍</Text>
        }} 
      />
      <Tabs.Screen 
        name="commitments" 
        options={{ 
          title: 'My Protein',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🛒</Text>
        }} 
      />
    </Tabs>
  );
}
