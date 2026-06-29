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
        bottom: 0,
        left: 0,
        right: 0,
        elevation: 0,
        height: Platform.OS === 'ios' ? 88 : 72,
        paddingBottom: Platform.OS === 'ios' ? 24 : 12,
        paddingTop: 12,
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.1)',
        backgroundColor: 'transparent',
        borderWidth: 0,
      },
      tabBarItemStyle: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      },
      tabBarBackground: () => (
        <BlurView 
          tint="dark" 
          intensity={40} 
          style={StyleSheet.absoluteFill} 
        />
      ),
      tabBarLabelStyle: {
        fontSize: 12,
        fontWeight: '600',
      },
      tabBarIconStyle: {
        marginTop: 0,
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
