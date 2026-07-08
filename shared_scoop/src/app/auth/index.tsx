import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useRouter } from 'expo-router';
import MatrixBackground from '../../components/MatrixBackground';
import LiquidCard from '../../components/LiquidCard';

export default function EmailAuthScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleAuth = async () => {
    if (!isLogin && !displayName.trim()) {
      setErrorMsg('Please provide a display name.');
      return;
    }

    if (!email.trim() || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    if (!isLogin && !phoneNumber.trim()) {
      setErrorMsg('Please provide a phone number for payment updates.');
      return;
    }
    
    setIsProcessing(true);
    setErrorMsg('');
    
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        router.replace('/(tabs)/dashboard');
      } else {
        const userCred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(userCred.user, { displayName: displayName.trim() });
        await setDoc(doc(db, 'users', userCred.user.uid), {
          displayName: displayName.trim(),
          email: email.trim().toLowerCase(),
          password: password,
          phone: phoneNumber.trim(),
          created_at: serverTimestamp()
        });
        router.replace('/(tabs)/dashboard');
      }
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/email-already-in-use') {
        // UNIFIED AUTH: Silent Login Fallback
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password);
          console.log("Unified Auth: Silent login successful.");
          router.replace('/(tabs)/dashboard');
        } catch (fallbackError: any) {
          setErrorMsg('Email is already registered, but the password provided is incorrect.');
        }
      } else if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        setErrorMsg('Invalid email or password.');
      } else if (error.code === 'auth/weak-password') {
        setErrorMsg('Password should be at least 6 characters.');
      } else {
        setErrorMsg(error.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <MatrixBackground />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.container}>
          <LiquidCard intensity={60} style={styles.card}>
            <Text style={styles.title}>SharedScoop</Text>
            <Text style={styles.subtitle}>
              {isLogin ? 'Sign in to continue' : 'Create an account to join pools'}
            </Text>
            
            {errorMsg !== '' && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
              </View>
            )}

            {!isLogin && (
              <TextInput
                style={styles.input}
                placeholder="Display Name (e.g. Adarsh S.)"
                placeholderTextColor="#6b7280"
                autoCapitalize="words"
                value={displayName}
                onChangeText={setDisplayName}
                editable={!isProcessing}
              />
            )}

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#6b7280"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              editable={!isProcessing}
            />
            
            {!isLogin && (
              <TextInput
                style={styles.input}
                placeholder="Phone Number (for payment links)"
                placeholderTextColor="#6b7280"
                keyboardType="phone-pad"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                editable={!isProcessing}
              />
            )}

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#6b7280"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              editable={!isProcessing}
            />
            
            <TouchableOpacity
              style={[styles.button, isProcessing && styles.disabledButton]}
              onPress={handleAuth}
              disabled={isProcessing}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>
                {isProcessing ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.textButton}
              onPress={() => {
                setIsLogin(!isLogin);
                setErrorMsg('');
                setDisplayName('');
                setPhoneNumber('');
              }}
              disabled={isProcessing}
            >
              <Text style={styles.textButtonText}>
                {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
              </Text>
            </TouchableOpacity>
          </LiquidCard>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    padding: 24,
    borderRadius: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f0f0ff',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    backgroundColor: 'rgba(20, 20, 30, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    fontSize: 16,
    color: '#f0f0ff',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#7c3aed',
    borderRadius: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    marginTop: 8,
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  textButton: {
    padding: 12,
    alignItems: 'center',
  },
  textButtonText: {
    color: '#a78bfa',
    fontSize: 14,
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    borderColor: 'rgba(220, 38, 38, 0.3)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
});
