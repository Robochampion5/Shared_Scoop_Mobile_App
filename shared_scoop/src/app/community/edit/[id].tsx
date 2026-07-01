import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, 
  StatusBar, TextInput, ScrollView, ActivityIndicator, 
  KeyboardAvoidingView, Platform, Alert 
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db, auth } from '../../../lib/firebase';
import LiquidCard from '../../../components/LiquidCard';
import MatrixBackground from '../../../components/MatrixBackground';
import Slider from '@react-native-community/slider';

export default function EditCommunityScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const communityId = typeof id === 'string' ? id : '';

  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const [name, setName] = useState('');
  const [locationArea, setLocationArea] = useState('');
  const [description, setDescription] = useState('');
  const [whatsappLink, setWhatsappLink] = useState('');
  
  const [orderId, setOrderId] = useState<string | null>(null);
  // sliderMoq: local UI state for real-time slider feedback (never triggers Firestore directly)
  const [sliderMoq, setSliderMoq] = useState(15);
  // totalKgRequired: persisted string used by the Save handler and display
  const [totalKgRequired, setTotalKgRequired] = useState('');
  const [moqError, setMoqError] = useState('');

  useEffect(() => {
    if (!communityId) return;

    const fetchCommunityAndOrder = async () => {
      try {
        const docRef = doc(db, 'communities', communityId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setName(data.name || '');
          setLocationArea(data.location_area || '');
          setDescription(data.description || '');
          setWhatsappLink(data.whatsapp_link || '');
        } else {
          Alert.alert('Error', 'Community not found', [{ text: 'OK', onPress: () => router.back() }], { cancelable: false });
          return;
        }

        const ordersRef = collection(db, 'orders');
        const q = query(ordersRef, where('community_id', '==', communityId), where('status', '==', 'pooling'), orderBy('created_at', 'desc'));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const orderDoc = querySnapshot.docs[0];
          setOrderId(orderDoc.id);
          const fetchedMoq = orderDoc.data().total_kg_required ?? 15;
          setTotalKgRequired(fetchedMoq.toString());
          setSliderMoq(Number(fetchedMoq) || 15);
        }
      } catch (error) {
        console.error('Error fetching details:', error);
        Alert.alert('Error', 'Failed to load details', [{ text: 'OK', onPress: () => router.back() }], { cancelable: false });
      } finally {
        setLoading(false);
      }
    };

    fetchCommunityAndOrder();
  }, [communityId]);

  const handleLockAndRequestPayments = async () => {
      if (isProcessing) return; // Mutex lock active
      
      const poolId = typeof id === 'string' ? id : (Array.isArray(id) ? id[0] : null);
      if (!poolId) {
          Alert.alert("Execution Error", "Critical routing failure: Pool ID is null.");
          return;
      }

      setIsProcessing(true);

      try {
          // 1. Secure the Auth Token
          const currentUser = auth.currentUser;
          if (!currentUser) throw new Error("Authentication critical failure. Ghost session detected.");
          const idToken = await currentUser.getIdToken(true);

          // 2. Network Request to Vercel Microservice
          const response = await fetch('https://shared-scoop-backend-czvvcscei-adarshsingh120308-2868s-projects.vercel.app/api/trigger-razorpay', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${idToken}`
              },
              body: JSON.stringify({ poolId })
          });

          // 3. Read raw text FIRST — never call .json() blindly
          const responseText = await response.text();
          console.log("API RAW RESPONSE:", responseText);
          console.log("HTTP STATUS:", response.status);

          // 4. Detect HTML error page (Vercel 404/500 returns HTML, not JSON)
          if (responseText.trimStart().startsWith('<')) {
              throw new Error(
                  `Vercel returned an HTML error page (HTTP ${response.status}). ` +
                  `This usually means the route /api/trigger-razorpay does not exist on the deployed backend. ` +
                  `Raw: ${responseText.substring(0, 200)}`
              );
          }

          // 5. Safe JSON parse
          let data: any;
          try {
              data = JSON.parse(responseText);
          } catch {
              throw new Error(`Response is not valid JSON (HTTP ${response.status}): ${responseText.substring(0, 200)}`);
          }

          if (!response.ok) {
              throw new Error(data.error || `Vercel rejected the payload with HTTP ${response.status}.`);
          }

          Alert.alert(
              "Pool Locked",
              "MOQ met. Razorpay payment links dispatched via SMS/Email to all pledged members."
          );
          
      } catch (error: unknown) {
          console.error("Razorpay Trigger Error:", error);
          Alert.alert(
              "Execution Failed",
              error instanceof Error ? error.message : "Razorpay network trigger failed."
          );
      } finally {
          setIsProcessing(false);
      }
  };

  const handleSave = async () => {
    setMoqError('');

    if (!name.trim() || !locationArea.trim()) {
      Alert.alert('Validation Error', 'Name and Location Area are required.', [{ text: 'OK' }], { cancelable: true });
      return;
    }

    let parsedMoq = 15;
    if (orderId && totalKgRequired) {
      parsedMoq = parseInt(totalKgRequired, 10);
      if (isNaN(parsedMoq) || parsedMoq < 15) {
        setMoqError('MOQ cannot be set below 15kg wholesale minimum.');
        Alert.alert('Validation Error', 'MOQ cannot drop below 15kg.', [{ text: 'OK' }]);
        return;
      }
    }

    if (isProcessing) return;
    setIsProcessing(true);
    let isSuccess = false;
    let errorMessage = "";

    try {
      const docRef = doc(db, 'communities', communityId);
      await updateDoc(docRef, {
        name: name.trim(),
        location_area: locationArea.trim(),
        description: description.trim(),
        whatsapp_link: whatsappLink.trim(),
      });

      if (orderId && totalKgRequired) {
        const orderRef = doc(db, 'orders', orderId);
        await updateDoc(orderRef, {
          total_kg_required: parsedMoq
        });
      }

      isSuccess = true;
    } catch (error: any) {
      console.error('Firestore Transaction Failed:', error);
      errorMessage = error.message || "An unknown error occurred.";
    }

    setIsProcessing(false);

    setTimeout(() => {
      if (isSuccess) {
        Alert.alert('Success', 'Community details updated successfully.', [
          { text: 'OK', onPress: () => router.back() }
        ], { cancelable: true, onDismiss: () => router.back() });
      } else {
        Alert.alert('Transaction Failed', errorMessage);
      }
    }, 100);
  };

  const handleDisband = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    let checkSuccess = false;
    let errorMessage = "";
    let hasActiveOrders = false;

    try {
      // Prerequisite check: active pooling orders
      const ordersRef = collection(db, 'orders');
      const q = query(ordersRef, where('community_id', '==', communityId), where('status', '==', 'pooling'), orderBy('created_at', 'desc'));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        hasActiveOrders = true;
      }
      checkSuccess = true;
    } catch (error: any) {
      console.error('Firestore Transaction Failed:', error);
      errorMessage = error.message || "An unknown error occurred.";
    }

    setIsProcessing(false);

    setTimeout(() => {
      if (!checkSuccess) {
        Alert.alert('Transaction Failed', errorMessage);
        return;
      }

      if (hasActiveOrders) {
        Alert.alert(
          'Cannot Disband', 
          'You cannot disband this community because there is an active pooling order. Please close or cancel the order first.',
          [{ text: 'OK' }],
          { cancelable: true }
        );
        return;
      }

      // Safe to delete
      Alert.alert(
        'Disband Community',
        'Are you sure you want to disband this community? This action cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Yes, Disband', 
            style: 'destructive', 
            onPress: async () => {
              // Wait for state to be fully settled before running internal action
              setTimeout(async () => {
                if (isProcessing) return;
                setIsProcessing(true);
                let deleteSuccess = false;
                let deleteErrorMsg = "";
                
                try {
                  await deleteDoc(doc(db, 'communities', communityId));
                  deleteSuccess = true;
                } catch (deleteError: any) {
                  console.error("Firestore Transaction Failed:", deleteError);
                  deleteErrorMsg = deleteError.message || "An unknown error occurred.";
                }
                
                setIsProcessing(false);
                
                setTimeout(() => {
                  if (deleteSuccess) {
                    router.replace('/(tabs)/dashboard');
                  } else {
                    Alert.alert("Transaction Failed", deleteErrorMsg);
                  }
                }, 100);
              }, 0);
            }
          }
        ],
        { cancelable: true }
      );
    }, 100);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#84cc16" />
          <Text style={styles.loadingText}>Loading details...</Text>
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
          onPress={() => { if (!isProcessing) router.back(); }}
          activeOpacity={0.7}
          disabled={isProcessing}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Community</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
          {/* Form Fields */}
          <LiquidCard intensity={60}>
            {moqError !== '' && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{moqError}</Text>
              </View>
            )}

            {orderId && (
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Active Order MOQ (kg) *</Text>
                <Slider
                  style={{ width: '100%', height: 44, marginTop: 8 }}
                  minimumValue={15}
                  maximumValue={100}
                  step={5}
                  // Bind to local state only — no Firestore write here
                  value={sliderMoq}
                  // Instant UI feedback: update local state on every frame
                  onValueChange={(val) => {
                    setSliderMoq(val);
                    setTotalKgRequired(val.toString());
                  }}
                  // Firestore write ONLY when user lifts finger
                  onSlidingComplete={async (val) => {
                    const clamped = Math.max(15, Math.round(val));
                    setSliderMoq(clamped);
                    setTotalKgRequired(clamped.toString());
                    if (orderId) {
                      try {
                        await updateDoc(doc(db, 'orders', orderId), {
                          total_kg_required: clamped,
                        });
                        console.log('MOQ auto-saved:', clamped);
                      } catch (e: any) {
                        console.warn('MOQ auto-save failed:', e.message);
                      }
                    }
                  }}
                  minimumTrackTintColor="#7c3aed"
                  maximumTrackTintColor="rgba(255,255,255,0.1)"
                  thumbTintColor="#34d399"
                  disabled={isProcessing}
                />
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#f0f0ff', textAlign: 'center', marginTop: 8 }}>
                  Current MOQ: {sliderMoq} kg
                </Text>
              </View>
            )}

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Community Name *</Text>
              <TextInput
                style={[styles.input, isProcessing && styles.disabledInput]}
                placeholder="e.g. Koramangala Iron Club"
                placeholderTextColor="#6b7280"
                value={name}
                onChangeText={setName}
                editable={!isProcessing}
              />
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Location Area *</Text>
              <TextInput
                style={[styles.input, isProcessing && styles.disabledInput]}
                placeholder="e.g. Koramangala"
                placeholderTextColor="#6b7280"
                value={locationArea}
                onChangeText={setLocationArea}
                editable={!isProcessing}
              />
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea, isProcessing && styles.disabledInput]}
                placeholder="Tell people what supplement brands you plan to order, delivery areas, etc."
                placeholderTextColor="#6b7280"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
                editable={!isProcessing}
              />
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>WhatsApp Group Link (Optional)</Text>
              <TextInput
                style={[styles.input, isProcessing && styles.disabledInput]}
                placeholder="https://chat.whatsapp.com/..."
                placeholderTextColor="#6b7280"
                value={whatsappLink}
                onChangeText={setWhatsappLink}
                autoCapitalize="none"
                keyboardType="url"
                editable={!isProcessing}
              />
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, isProcessing ? styles.disabledButton : {}]}
              onPress={handleSave}
              activeOpacity={0.8}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.submitButtonText}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </LiquidCard>

          {/* Razorpay Trigger Action */}
          <LiquidCard intensity={60} style={{ borderColor: 'rgba(52, 211, 153, 0.3)', borderWidth: 1 }}>
            <View style={styles.actionZone}>
              <Text style={styles.actionTitle}>Financial Operations</Text>
              <Text style={styles.actionDesc}>Lock the pool to finalize wholesale requirements and instantly dispatch Razorpay payment links to all pledged members.</Text>
              <TouchableOpacity
                  style={[
                      styles.actionButton,
                      isProcessing ? styles.actionButtonDisabled : {}
                  ]}
                  onPress={handleLockAndRequestPayments}
                  disabled={isProcessing}
              >
                  {isProcessing ? (
                      <ActivityIndicator color="#0f0f1a" size="small" />
                  ) : (
                      <Text style={styles.actionButtonText}>Lock Pool & Request Payments</Text>
                  )}
              </TouchableOpacity>
            </View>
          </LiquidCard>

          {/* Delete Button */}
          <LiquidCard intensity={60} style={{ borderColor: 'rgba(220, 38, 38, 0.3)', borderWidth: 1 }}>
            <View style={styles.dangerZone}>
              <Text style={styles.dangerTitle}>Danger Zone</Text>
              <Text style={styles.dangerDesc}>Once you disband a community, there is no going back. Please be certain.</Text>
              <TouchableOpacity
                style={[styles.deleteButton, isProcessing ? styles.disabledButton : {}]}
                onPress={handleDisband}
                activeOpacity={0.8}
                disabled={isProcessing}
              >
                <Text style={styles.deleteButtonText}>Disband Community</Text>
              </TouchableOpacity>
            </View>
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
  disabledInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#9ca3af',
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
  actionZone: {
    gap: 8,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#34d399',
  },
  actionDesc: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
    marginBottom: 8,
  },
  actionButton: {
    backgroundColor: '#34d399',
    borderRadius: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#0f0f1a',
    fontSize: 16,
    fontWeight: '700',
  },
  actionButtonDisabled: { 
    opacity: 0.5, 
    backgroundColor: '#4a4a5a' 
  },
  dangerZone: {
    gap: 8,
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ef4444',
  },
  dangerDesc: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
    marginBottom: 8,
  },
  deleteButton: {
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.3)',
    borderRadius: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonText: {
    color: '#ef4444',
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
    color: '#9ca3af',
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
