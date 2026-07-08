import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, ScrollView, StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, addDoc } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '../../lib/firebase';
import LiquidCard from '../../components/LiquidCard';
import MatrixBackground from '../../components/MatrixBackground';

export default function CreateCommunityScreen() {
  const router = useRouter();

  // Auth state
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Form states
  const [name, setName] = useState("");
  const [locationArea, setLocationArea] = useState("");
  const [description, setDescription] = useState("");
  const [whatsappLink, setWhatsappLink] = useState("");

  // Submit state — single source of truth for ALL async locks
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Track auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleCreate = async () => {
    if (!currentUser) return;
    if (isProcessing) return;
    setErrorMsg("");

    // Validation
    if (!name.trim()) {
      setErrorMsg("Community Name is required.");
      return;
    }
    if (!locationArea.trim()) {
      setErrorMsg("Location Area is required.");
      return;
    }

    setIsProcessing(true);
    let isSuccess = false;
    let errorMessage = "";
    let newDocId: string | null = null;

    try {
      const docRef = await addDoc(collection(db, "communities"), {
        name: name.trim(),
        location_area: locationArea.trim(),
        description: description.trim(),
        whatsapp_link: whatsappLink.trim(),
        admin_uid: currentUser.uid,
        members: [currentUser.uid],
        created_at: new Date().toISOString()
      });
      if (docRef?.id) newDocId = docRef.id;
      isSuccess = true;
    } catch (err: any) {
      console.error("Firestore Transaction Failed:", err);
      errorMessage = err.message || "Failed to create community. Please try again.";
    }

    // Unlock UI synchronously BEFORE any native modal or navigation
    setIsProcessing(false);

    setTimeout(() => {
      if (isSuccess && newDocId) {
        router.replace(`/community/${newDocId}`);
      } else {
        setErrorMsg(errorMessage);
      }
    }, 100);
  };

  if (authLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#84cc16" />
          <Text style={styles.loadingText}>Initializing authentication...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f1a" />
      <MatrixBackground />
      <View style={styles.navHeader}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={styles.backButtonText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Community</Text>
        <View style={{ width: 60 }} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
          <LiquidCard intensity={60}>
            <Text style={styles.description}>
              Launch a supplement buying group in your locality. Group buying helps unlock wholesaler MOQ prices.
            </Text>

            {errorMsg !== "" && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
              </View>
            )}

            {/* Form Fields */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Community Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Koramangala Iron Club"
                placeholderTextColor="#6b7280"
                value={name}
                onChangeText={setName}
              />
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Location Area *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Koramangala"
                placeholderTextColor="#6b7280"
                value={locationArea}
                onChangeText={setLocationArea}
              />
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Tell people what supplement brands you plan to order, delivery areas, etc."
                placeholderTextColor="#6b7280"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>WhatsApp Group Link (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="https://chat.whatsapp.com/..."
                placeholderTextColor="#6b7280"
                value={whatsappLink}
                onChangeText={setWhatsappLink}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, isProcessing && styles.disabledButton]}
              onPress={handleCreate}
              activeOpacity={0.8}
              disabled={isProcessing}
            >
              <Text style={styles.submitButtonText}>
                {isProcessing ? "Processing..." : "Create Group"}
              </Text>
            </TouchableOpacity>
          </LiquidCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  navHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0f0f1a',
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a78bfa',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f0f0ff',
  },
  contentContainer: {
    padding: 20,
    gap: 16,
  },
  description: {
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
    marginBottom: 8,
  },
  errorBox: {
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    borderColor: 'rgba(220, 38, 38, 0.3)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  fieldContainer: {
    gap: 6,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f0f0ff',
  },
  input: {
    backgroundColor: 'rgba(20, 20, 30, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    fontSize: 15,
    color: '#f0f0ff',
  },
  textArea: {
    height: 100,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  disabledButton: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '500',
  },
});
