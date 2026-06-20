// Author: Adarsh Singh | Roll No: IC2025006
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import MatrixBackground from '@/components/MatrixBackground';

export default function RootIndex() {
  const router = useRouter();
  const [isMounting, setIsMounting] = useState(true);

  useEffect(() => {
    // The Bouncer: Listens for the Firebase Auth state
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        // User is logged in -> Throw them to the Dashboard
        router.replace('/(tabs)/dashboard');
      } else {
        // No user -> Throw them to the Liquid Glass Auth Screen
        router.replace('/auth');
      }
      setIsMounting(false);
    });

    return () => unsubscribe();
  }, [router]);

  // While Firebase is checking the token, show the Matrix background and a spinner
  if (isMounting) {
    return (
      <View style={styles.container}>
        <MatrixBackground />
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
