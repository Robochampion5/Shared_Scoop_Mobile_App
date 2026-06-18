// Author: Adarsh Singh | Roll No: IC2025006
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export default function Layout() {
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Authenticate user anonymously to ensure a valid UID is available for writes
      if (!user) {
        signInAnonymously(auth).catch((err) => {
          console.error("Error signing in anonymously:", err);
        });
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  if (!isAuthReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f1a' }}>
          <ActivityIndicator size="large" color="#7c3aed" />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="community/[id]" />
        <Stack.Screen name="community/create" />
        <Stack.Screen name="community/edit/[id]" />
      </Stack>
    </GestureHandlerRootView>
  );
}
