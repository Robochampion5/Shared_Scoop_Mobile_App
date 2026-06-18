import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, StatusBar, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, collection, query, where, onSnapshot, addDoc, deleteDoc, updateDoc, orderBy, limit, increment, getDocs } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { Community, Order, Product, Contribution } from '@/lib/types';

export default function CommunityDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const communityId = typeof id === 'string' ? id : '';

  // Auth State
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Real-time state from Firebase
  const [community, setCommunity] = useState<Community | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [userContribution, setUserContribution] = useState<Contribution | null>(null);
  
  // UI Locks and Inputs
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [otpInput, setOtpInput] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser || !communityId) return;
    const docRef = doc(db, "communities", communityId);
    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        setCommunity({ id: snapshot.id, ...snapshot.data() } as Community);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error loading community details:", error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser, communityId]);

  useEffect(() => {
    if (!currentUser || !communityId) return;
    const membershipsQuery = query(
      collection(db, "memberships"),
      where("community_id", "==", communityId),
      where("status", "==", "approved")
    );
    const unsubscribe = onSnapshot(membershipsQuery, (snapshot) => {
      setMemberCount(snapshot.size);
    }, (error) => console.error("Error loading membership counts:", error));
    return () => unsubscribe();
  }, [currentUser, communityId]);

  useEffect(() => {
    if (!currentUser || !communityId) return;
    const ordersQuery = query(
      collection(db, "orders"),
      where("community_id", "==", communityId),
      where("status", "in", ["pooling", "completed"]),
      orderBy("created_at", "desc"),
      limit(1)
    );
    const unsubscribe = onSnapshot(ordersQuery, (snapshot) => {
      if (!snapshot.empty) {
        const d = snapshot.docs[0];
        setActiveOrder({ id: d.id, ...d.data() } as Order);
      } else {
        setActiveOrder(null);
      }
    }, (error) => console.error("Error loading orders:", error));
    return () => unsubscribe();
  }, [currentUser, communityId]);

  useEffect(() => {
    if (!currentUser || !activeOrder?.product_id) {
      setProduct(null);
      return;
    }
    const productRef = doc(db, "products", activeOrder.product_id);
    const unsubscribe = onSnapshot(productRef, (snapshot) => {
      if (snapshot.exists()) setProduct({ id: snapshot.id, ...snapshot.data() } as Product);
    }, (error) => console.error("Error loading product details:", error));
    return () => unsubscribe();
  }, [currentUser, activeOrder?.product_id]);

  useEffect(() => {
    if (!currentUser || !activeOrder?.id) {
      setUserContribution(null);
      return;
    }
    const contributionsQuery = query(
      collection(db, "contributions"),
      where("order_id", "==", activeOrder.id),
      where("user_id", "==", currentUser.uid)
    );
    const unsubscribe = onSnapshot(contributionsQuery, (snapshot) => {
      if (!snapshot.empty) {
        const d = snapshot.docs[0];
        setUserContribution({ id: d.id, ...d.data() } as Contribution);
      } else {
        setUserContribution(null);
      }
    }, (error) => console.error("Error loading user contribution:", error));
    return () => unsubscribe();
  }, [currentUser, activeOrder?.id]);

  const handleJoinPress = async () => {
    if (!currentUser || !activeOrder || !product || isProcessing) return;
    setIsProcessing(true);
    let isSuccess = false;
    let errorMessage = "";

    try {
      if (userContribution) {
        const contributionId = userContribution.id;
        const kgToRemove = userContribution.kg_committed;
        await deleteDoc(doc(db, "contributions", contributionId));
        await updateDoc(doc(db, "orders", activeOrder.id), {
          total_kg_committed: increment(-kgToRemove)
        });
      } else {
        let weightNum = 2;
        if (product.weight) {
          const match = product.weight.match(/([0-9.]+)/);
          if (match) weightNum = parseFloat(match[1]);
        }
        const amountPaid = weightNum * (product.wholesale_price || 0);
        
        // UNIQUE OTP GENERATION: Each user gets their own specific token
        const uniqueOtp = Math.floor(100000 + Math.random() * 900000).toString();
        
        await addDoc(collection(db, "contributions"), {
          order_id: activeOrder.id,
          user_id: currentUser.uid,
          kg_committed: weightNum,
          amount_paid: amountPaid,
          status: "pending",
          delivery_otp: uniqueOtp,
          created_at: new Date().toISOString()
        });
        await updateDoc(doc(db, "orders", activeOrder.id), {
          total_kg_committed: increment(weightNum)
        });
      }
      isSuccess = true;
    } catch (error: any) {
      console.error("Firestore Transaction Failed:", error);
      errorMessage = error.message || "An unknown error occurred.";
    }

    setIsProcessing(false);
    setTimeout(() => {
      if (!isSuccess) Alert.alert("Transaction Failed", errorMessage);
    }, 100);
  };

  const handleStartOrder = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    let isSuccess = false;
    let errorMessage = "";

    try {
      const productsSnapshot = await getDocs(collection(db, "products"));
      let productId = "";

      if (productsSnapshot.empty) {
        const defaultProduct = {
          name: "Default Whey Protein",
          description: "Standard whey protein supplement",
          wholesale_price: 3000,
          retail_price: 4000,
          weight: "2",
          image_url: "",
          created_at: new Date().toISOString()
        };
        const productDocRef = await addDoc(collection(db, "products"), defaultProduct);
        productId = productDocRef.id;
      } else {
        productId = productsSnapshot.docs[0].id;
      }

      await addDoc(collection(db, "orders"), {
        community_id: communityId,
        product_id: productId,
        total_kg_required: 20,
        total_kg_committed: 0,
        status: "pooling",
        created_at: new Date().toISOString()
      });
      isSuccess = true;
    } catch (error: any) {
      console.error("Firestore Transaction Failed:", error);
      errorMessage = error.message || "An unknown error occurred.";
    }

    setIsProcessing(false);
    setTimeout(() => {
      if (isSuccess) Alert.alert("Success", "New order started successfully!", [{ text: "OK" }], { cancelable: true });
      else Alert.alert("Transaction Failed", errorMessage);
    }, 100);
  };

  const handleCloseOrder = async () => {
    if (isProcessing || !activeOrder) return;
    setIsProcessing(true);

    if (activeOrder.total_kg_committed < activeOrder.total_kg_required) {
      setTimeout(() => {
        Alert.alert(
          "Warning: MOQ Not Met",
          `The MOQ of ${activeOrder.total_kg_required} kg is not met (currently ${(activeOrder.total_kg_committed || 0).toFixed(1)} kg). Close anyway?`,
          [
            { text: "Cancel", style: "cancel", onPress: () => setIsProcessing(false) },
            {
              text: "Yes, Close Order",
              onPress: async () => {
                let isSuccess = false;
                let errorMessage = "";
                try {
                  await updateDoc(doc(db, "orders", activeOrder.id), { status: "completed" });
                  isSuccess = true;
                } catch (error: any) {
                  console.error(error);
                  errorMessage = error.message || "Unknown error occurred.";
                }
                setIsProcessing(false);
                setTimeout(() => {
                  if (isSuccess) Alert.alert("Success", "Order closed successfully!");
                  else Alert.alert("Transaction Failed", errorMessage);
                }, 100);
              }
            }
          ],
          { cancelable: true, onDismiss: () => setIsProcessing(false) }
        );
      }, 50);
    } else {
      let isSuccess = false;
      let errorMessage = "";
      try {
        await updateDoc(doc(db, "orders", activeOrder.id), { status: "completed" });
        isSuccess = true;
      } catch (error: any) {
        console.error("Firestore Transaction Failed:", error);
        errorMessage = error.message || "An unknown error occurred.";
      }
      setIsProcessing(false);
      setTimeout(() => {
        if (isSuccess) Alert.alert("Success", "Order closed successfully!");
        else Alert.alert("Transaction Failed", errorMessage);
      }, 100);
    }
  };

  const handleVerifyOTP = async () => {
    if (isProcessing || !activeOrder || otpInput.length < 6) return;
    setIsProcessing(true);
    let isSuccess = false;
    let alertTitle = "";
    let alertMsg = "";

    try {
      const q = query(
        collection(db, "contributions"),
        where("order_id", "==", activeOrder.id),
        where("delivery_otp", "==", otpInput.trim())
      );
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        alertTitle = "Invalid OTP";
        alertMsg = "No matching token found for this order.";
      } else {
        const contributionDoc = snapshot.docs[0];
        if (contributionDoc.data().status === "delivered") {
          alertTitle = "Already Claimed";
          alertMsg = "This OTP has already been used to claim protein.";
        } else {
          await updateDoc(doc(db, "contributions", contributionDoc.id), { status: "delivered" });
          isSuccess = true;
          alertTitle = "Success";
          alertMsg = "Token verified! Contribution marked as delivered.";
        }
      }
    } catch (error: any) {
      console.error(error);
      alertTitle = "Error";
      alertMsg = error.message;
    }

    setIsProcessing(false);
    setOtpInput(""); // Clear the input field automatically

    setTimeout(() => {
      Alert.alert(alertTitle, alertMsg);
    }, 100);
  };

  const progressPct = activeOrder && activeOrder.total_kg_required > 0 
    ? Math.min(((activeOrder.total_kg_committed || 0) / activeOrder.total_kg_required) * 100, 100)
    : 0;

  const isAdmin = !!(community && currentUser && community.admin_uid === currentUser.uid);

  if (authLoading || loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#84cc16" />
          <Text style={styles.loadingText}>{authLoading ? "Initializing auth..." : "Loading details..."}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!community) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.navHeader}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.productName}>Community not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.navHeader}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.communityHeaderCard}>
          <Text style={styles.communityName}>{community.name}</Text>
          <View style={styles.communityMetaRow}>
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>📍 {community.location_area || "General"}</Text>
            </View>
            <Text style={styles.metaMembers}>•  {memberCount} Members</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Active Group-Buy Deal</Text>

        {activeOrder && product ? (
          <View style={styles.dealCard}>
            <View style={styles.brandBadge}>
              <Text style={styles.brandBadgeText}>{product.name.split(" ")[0] || "Supplement"}</Text>
            </View>
            <Text style={styles.productName}>{product.name}</Text>
            <Text style={styles.dealDetail}>Flavor: <Text style={styles.boldText}>{product.description || "Default"}</Text></Text>
            <Text style={styles.dealDetail}>Weight: <Text style={styles.boldText}>{product.weight || "N/A"}</Text></Text>

            <View style={styles.priceRow}>
              <Text style={styles.discountPrice}>₹{product.wholesale_price}</Text>
              <Text style={styles.originalPrice}>₹{product.retail_price}</Text>
              <View style={styles.discountBadge}>
                <Text style={styles.discountBadgeText}>
                  {product.retail_price && product.wholesale_price
                    ? `${Math.round(((product.retail_price - product.wholesale_price) / product.retail_price) * 100)}% OFF`
                    : "Discount"}
                </Text>
              </View>
            </View>
            <Text style={styles.wholesaleLabel}>Wholesale Pricing unlocked via group buy</Text>
          </View>
        ) : (
          <View style={styles.dealCard}>
            <Text style={styles.productName}>No Active Group Buy Deal</Text>
            <Text style={styles.dealDetail}>The community admin hasn't created a pool for this group yet.</Text>
          </View>
        )}

        {activeOrder && product && activeOrder.status === 'pooling' && (
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>Group Progress</Text>
              <Text style={styles.progressRatio}>
                {(activeOrder.total_kg_committed || 0).toFixed(1)} / {activeOrder.total_kg_required} kg
              </Text>
            </View>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
            </View>
            <Text style={styles.progressDescription}>
              {progressPct >= 100 
                ? "Wholesale tier reached! Order is ready to dispatch." 
                : `Need ${(activeOrder.total_kg_required - (activeOrder.total_kg_committed || 0)).toFixed(1)} kg more committed to unlock wholesale price.`}
            </Text>
          </View>
        )}

        {isAdmin ? (
          <View style={styles.adminCard}>
            <Text style={styles.adminCardTitle}>👑 Manage Orders (Admin Panel)</Text>
            
            {activeOrder ? (
              <>
                <View style={styles.adminStatsRow}>
                  <View style={styles.adminStatItem}>
                    <Text style={styles.adminStatVal}>{(activeOrder.total_kg_committed || 0).toFixed(1)} kg</Text>
                    <Text style={styles.adminStatLbl}>Committed</Text>
                  </View>
                  <View style={styles.adminStatDivider} />
                  <View style={styles.adminStatItem}>
                    <Text style={styles.adminStatVal}>{activeOrder.total_kg_required} kg</Text>
                    <Text style={styles.adminStatLbl}>MOQ Target</Text>
                  </View>
                  <View style={styles.adminStatDivider} />
                  <View style={styles.adminStatItem}>
                    <Text style={styles.adminStatVal}>{activeOrder.status}</Text>
                    <Text style={styles.adminStatLbl}>Status</Text>
                  </View>
                </View>

                {activeOrder.status === 'pooling' ? (
                  <>
                    <Text style={styles.adminCardText}>Monitor progress. Once MOQ is met, close the order to trigger physical fulfillment.</Text>
                    <TouchableOpacity 
                      style={[styles.adminActionBtn, styles.dangerBtn, isProcessing && styles.disabledBtn]} 
                      activeOpacity={0.8}
                      onPress={handleCloseOrder}
                      disabled={isProcessing}
                    >
                      <Text style={styles.adminActionBtnText}>
                        {isProcessing ? "Processing..." : "Close Order"}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : activeOrder.status === 'completed' ? (
                  <View style={styles.verificationContainer}>
                    <Text style={styles.adminCardText}>
                      Order is closed. Enter a student's secure pickup token (OTP) below to physically hand over their protein and mark it as delivered.
                    </Text>
                    <TextInput
                      style={[styles.input, isProcessing && styles.disabledInput]}
                      placeholder="Enter 6-digit OTP"
                      placeholderTextColor="#9ca3af"
                      keyboardType="number-pad"
                      maxLength={6}
                      value={otpInput}
                      onChangeText={setOtpInput}
                      editable={!isProcessing}
                    />
                    <TouchableOpacity
                      style={[styles.adminActionBtn, { marginTop: 12 }, isProcessing && styles.disabledBtn]}
                      activeOpacity={0.8}
                      onPress={handleVerifyOTP}
                      disabled={isProcessing || otpInput.length < 6}
                    >
                      <Text style={styles.adminActionBtnText}>
                        {isProcessing ? "Verifying..." : "Verify & Deliver"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.adminCardText}>There is currently no active group buy order. Start a new one below.</Text>
                <TouchableOpacity 
                  style={[styles.adminActionBtn, isProcessing && styles.disabledBtn]} 
                  activeOpacity={0.8}
                  onPress={handleStartOrder}
                  disabled={isProcessing}
                >
                  <Text style={styles.adminActionBtnText}>
                    {isProcessing ? "Processing..." : "Start New Order"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
            {/* Edit Details Button */}
            <TouchableOpacity 
              style={[styles.editDetailsBtn, { marginTop: 12 }]} 
              activeOpacity={0.8}
              onPress={() => router.push(`/community/edit/${communityId}`)}
            >
              <Text style={styles.editDetailsBtnText}>Edit Details</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Join / Leave button — rendered for ALL users including admin (test mode) */}
        {activeOrder && product && activeOrder.status === 'pooling' && (
          <TouchableOpacity 
            style={[
              styles.joinButton, 
              userContribution && styles.joinedButton, 
              isProcessing && { opacity: 0.6 },
              isAdmin && { marginTop: 12, backgroundColor: '#4f46e5' }
            ]}
            onPress={handleJoinPress}
            activeOpacity={0.8}
            disabled={isProcessing}
          >
            <Text style={styles.joinButtonText}>
              {isProcessing ? "Processing..." : userContribution ? "Leave Group Buy" : isAdmin ? "Join Group Buy (Test Mode)" : "Join Group Buy"}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f9fafb' },
  navHeader: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#ffffff' },
  backButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#f3f4f6', borderRadius: 8, alignSelf: 'flex-start' },
  backButtonText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  contentContainer: { padding: 20, gap: 20 },
  communityHeaderCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#e5e7eb' },
  communityName: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 8 },
  communityMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaBadge: { backgroundColor: '#f3f4f6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  metaBadgeText: { fontSize: 12, fontWeight: '500', color: '#4b5563' },
  metaMembers: { fontSize: 13, color: '#6b7280' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: -8 },
  dealCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#e5e7eb' },
  brandBadge: { backgroundColor: 'rgba(132, 204, 22, 0.1)', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 12 },
  brandBadgeText: { color: '#84cc16', fontWeight: '600', fontSize: 11, textTransform: 'uppercase' },
  productName: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 10 },
  dealDetail: { fontSize: 14, color: '#4b5563', marginBottom: 6 },
  boldText: { fontWeight: '600', color: '#111827' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  discountPrice: { fontSize: 20, fontWeight: '700', color: '#111827' },
  originalPrice: { fontSize: 14, color: '#9ca3af', textDecorationLine: 'line-through' },
  discountBadge: { backgroundColor: '#ef4444', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  discountBadgeText: { color: '#ffffff', fontWeight: '700', fontSize: 11 },
  wholesaleLabel: { fontSize: 12, color: '#84cc16', fontWeight: '500', marginTop: 8 },
  progressCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#e5e7eb' },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  progressTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  progressRatio: { fontSize: 14, fontWeight: '600', color: '#374151' },
  progressBarContainer: { height: 12, backgroundColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden', marginBottom: 12 },
  progressBarFill: { height: '100%', backgroundColor: '#84cc16', borderRadius: 6 },
  progressDescription: { fontSize: 13, color: '#6b7280', lineHeight: 18 },
  joinButton: { backgroundColor: '#111827', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  joinedButton: { backgroundColor: '#ef4444' },
  joinButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  loadingText: { marginTop: 12, color: '#6b7280', fontSize: 14, fontWeight: '500' },
  adminCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#f59e0b', marginTop: 8 },
  adminCardTitle: { fontSize: 16, fontWeight: '700', color: '#d97706', marginBottom: 8 },
  adminCardText: { fontSize: 13, color: '#4b5563', lineHeight: 18, marginBottom: 16 },
  adminStatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fffbeb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16 },
  adminStatItem: { alignItems: 'center', flex: 1 },
  adminStatVal: { fontSize: 15, fontWeight: '700', color: '#111827' },
  adminStatLbl: { fontSize: 11, color: '#6b7280', marginTop: 2, fontWeight: '500' },
  adminStatDivider: { width: 1, height: 24, backgroundColor: '#fcd34d' },
  adminActionBtn: { backgroundColor: '#d97706', borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' },
  adminActionBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  dangerBtn: { backgroundColor: '#ef4444' },
  disabledBtn: { opacity: 0.5 },
  editDetailsBtn: { backgroundColor: '#374151', borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' },
  editDetailsBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  verificationContainer: { backgroundColor: '#f9fafb', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', marginTop: 4 },
  input: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 16, height: 48, fontSize: 18, color: '#111827', marginTop: 8, textAlign: 'center', letterSpacing: 4, fontWeight: '600' },
  disabledInput: { opacity: 0.6, backgroundColor: '#f3f4f6' }
});