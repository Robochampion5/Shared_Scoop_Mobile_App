import React from 'react';
import { Tabs } from 'expo-router';
import { Text, Platform } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ 
      headerShown: false,
      tabBarActiveTintColor: '#84cc16',
      tabBarInactiveTintColor: '#6b7280',
      tabBarStyle: {
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
        height: Platform.OS === 'ios' ? 88 : 64,
        paddingBottom: Platform.OS === 'ios' ? 28 : 10,
        paddingTop: 10,
      },
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '600',
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
