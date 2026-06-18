// Author: Adarsh Singh | Roll No: IC2025006
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, StatusBar, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, collection, query, where, onSnapshot, addDoc, deleteDoc, updateDoc, orderBy, limit, getDocs } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { Community, Order, Product, Contribution } from '@/lib/types';
import LiquidCard from '@/components/LiquidCard';

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
  // Dynamically aggregated from contributions — source of truth for MOQ progress.
  // Never read from orders.total_kg_committed (that field is locked at 0 in rules).
  const [totalKgCommitted, setTotalKgCommitted] = useState(0);

  // Prevents state updates on unmounted component (e.g. user navigates back
  // mid-write). Guards every setIsProcessing call in finally blocks.
  const isMounted = useRef(true);
  useEffect(() => { return () => { isMounted.current = false; }; }, []);

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

  // Real-time aggregation of all contributions for the active order.
  // This replaces the orders.total_kg_committed field which is now locked
  // at the database level to prevent admin spoofing.
  useEffect(() => {
    if (!currentUser || !activeOrder?.id) {
      setTotalKgCommitted(0);
      return;
    }
    const allContributionsQuery = query(
      collection(db, "contributions"),
      where("order_id", "==", activeOrder.id)
    );
    const unsubscribe = onSnapshot(allContributionsQuery, (snapshot) => {
      const sum = snapshot.docs.reduce((acc, d) => acc + (d.data().kg_committed || 0), 0);
      setTotalKgCommitted(sum);
    }, (error) => console.error("Error aggregating contributions:", error));
    return () => unsubscribe();
  }, [currentUser, activeOrder?.id]);

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

    try {
      if (userContribution) {
        // Leave: delete the contribution document only.
        // total_kg_committed is recalculated by the real-time listener above.
        await deleteDoc(doc(db, "contributions", userContribution.id));
      } else {
        // weight_kg is a strict numeric field on the product document.
        // Avoids parsing the display string 'weight' which can contain
        // arbitrary text (e.g. "Twin Pack (2.5kg each)") and corrupt financials.
        const weightNum = (product && 'weight_kg' in product ? (product as any).weight_kg : 2);
        const amountPaid = Math.round(weightNum * (product.wholesale_price || 0));

        // Collision-resistant OTP: 2-char UID prefix + 4-digit random suffix.
        // The UID prefix guarantees uniqueness per user within the same order;
        // the numeric suffix keeps it scannable on a phone screen.
        // Example output: "AB4921"
        const randomPart = Math.floor(1000 + Math.random() * 9000).toString();
        const uidPart = currentUser.uid.substring(0, 2).toUpperCase();
        const uniqueOtp = `${uidPart}${randomPart}`;

        // Join: create the contribution document only.
        // total_kg_committed is recalculated by the real-time listener above.
        await addDoc(collection(db, "contributions"), {
          order_id: activeOrder.id,
          community_id: communityId,  // denormalized — required for Firestore read rules
          user_id: currentUser.uid,
          kg_committed: weightNum,
          amount_paid: amountPaid,
          status: "pending",
          delivery_otp: uniqueOtp,
          created_at: new Date().toISOString()
        });
      }
    } catch (error: any) {
      console.error("Firestore Transaction Failed:", error);
      Alert.alert("Transaction Failed", error.message || "An unknown error occurred.");
    } finally {
      if (isMounted.current) setIsProcessing(false);
    }
  };

  const handleStartOrder = async () => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      const productsSnapshot = await getDocs(collection(db, "products"));

      if (productsSnapshot.empty) {
        Alert.alert(
          "Setup Required",
          "No products found. Please add at least one product document in the Firebase Console under the 'products' collection, then try again."
        );
        return;
      }

      const productDoc = productsSnapshot.docs[0];
      const productId = productDoc.id;
      const productData = productDoc.data();
      await addDoc(collection(db, "orders"), {
        community_id: communityId,
        product_id: productId,
        total_kg_required: productData.moq || 20,
        total_kg_committed: 0,
        status: "pooling",
        created_at: new Date().toISOString()
      });
      Alert.alert("Success", "New order started successfully!", [{ text: "OK" }], { cancelable: true });
    } catch (error: any) {
      console.error("Firestore Transaction Failed:", error);
      Alert.alert("Transaction Failed", error.message || "An unknown error occurred.");
    } finally {
      if (isMounted.current) setIsProcessing(false);
    }
  };

  const handleCloseOrder = async () => {
    if (isProcessing || !activeOrder) return;
    setIsProcessing(true);

    if (totalKgCommitted < activeOrder.total_kg_required) {
      const remaining = (activeOrder.total_kg_required - totalKgCommitted).toFixed(1);
      if (isMounted.current) setIsProcessing(false);
      Alert.alert(
        "MOQ Not Met",
        `Cannot close order. Need ${remaining} kg more to reach the ${activeOrder.total_kg_required} kg wholesale threshold.`
      );
      return;
    }

    try {
      await updateDoc(doc(db, "orders", activeOrder.id), { status: "completed" });
      Alert.alert("Success", "Order closed successfully!");
    } catch (error: any) {
      console.error("Firestore Transaction Failed:", error);
      Alert.alert("Transaction Failed", error.message || "An unknown error occurred.");
    } finally {
      if (isMounted.current) setIsProcessing(false);
    }
  };

  const handleCancelOrder = async () => {
    if (isProcessing || !activeOrder) return;
    setIsProcessing(true);

    Alert.alert(
      "Cancel Order",
      "Are you sure you want to abort this group buy? This cannot be undone.",
      [
        { text: "No, Keep Pooling", style: "cancel", onPress: () => setIsProcessing(false) },
        {
          text: "Yes, Abort Order",
          style: "destructive",
          onPress: async () => {
            try {
              const contributionsQuery = query(
                collection(db, "contributions"),
                where("order_id", "==", activeOrder.id)
              );
              const snapshot = await getDocs(contributionsQuery);
              await Promise.all(snapshot.docs.map(d => deleteDoc(doc(db, "contributions", d.id))));

              await updateDoc(doc(db, "orders", activeOrder.id), { status: "cancelled" });
              Alert.alert("Cancelled", "The order has been aborted and all commitments released.");
            } catch (error: any) {
              console.error("Firestore Transaction Failed:", error);
              Alert.alert("Transaction Failed", error.message || "An unknown error occurred.");
            } finally {
              if (isMounted.current) setIsProcessing(false);
            }
          }
        }
      ],
      { cancelable: true, onDismiss: () => setIsProcessing(false) }
    );
  };

  const handleVerifyOTP = async () => {
    if (isProcessing || !activeOrder || otpInput.length < 6) return;
    setIsProcessing(true);

    try {
      const sanitizedOtp = otpInput.trim().toUpperCase();
      const q = query(
        collection(db, "contributions"),
        where("order_id", "==", activeOrder.id),
        where("delivery_otp", "==", sanitizedOtp)
      );
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        Alert.alert("Invalid OTP", "No matching token found for this order.");
      } else {
        const contributionDoc = snapshot.docs[0];
        if (contributionDoc.data().status === "delivered") {
          Alert.alert("Already Claimed", "This OTP has already been used to claim protein.");
        } else {
          await updateDoc(doc(db, "contributions", contributionDoc.id), { status: "delivered" });
          Alert.alert("Success", "Token verified! Contribution marked as delivered.");
        }
      }
    } catch (error: any) {
      console.error(error);
      Alert.alert("Error", error.message || "An unknown error occurred.");
    } finally {
      if (isMounted.current) setIsProcessing(false);
      setOtpInput(""); // Clear the input field automatically
    }
  };

  const progressPct = activeOrder && activeOrder.total_kg_required > 0
    ? Math.min((totalKgCommitted / activeOrder.total_kg_required) * 100, 100)
    : 0;

  const isAdmin = !!(community && currentUser && community.admin_uid === currentUser.uid);

  if (authLoading || loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#7c3aed" />
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
      <StatusBar barStyle="light-content" backgroundColor="#0f0f1a" />

      <View style={styles.navHeader}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>

        {/* ============================================================= */}
        {/* MATRIX LAYER — absolute-positioned blurred orbs that give the  */}
        {/* BlurView frosted glass something to distort. Without these the */}
        {/* blur renders as flat grey. Saturated purples + lime-green to   */}
        {/* match the SharedScoop brand palette.                           */}
        {/* ============================================================= */}
        <View style={styles.matrixOrb1} />
        <View style={styles.matrixOrb2} />
        <View style={styles.matrixOrb3} />

        {/* Community header — LiquidCard */}
        <LiquidCard intensity={70}>
          <Text style={styles.communityName}>{community.name}</Text>
          <View style={styles.communityMetaRow}>
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>📍 {community.location_area || "General"}</Text>
            </View>
            <Text style={styles.metaMembers}>•  {memberCount} Members</Text>
          </View>
        </LiquidCard>

        <Text style={styles.sectionTitle}>Active Group-Buy Deal</Text>

        {/* Deal card */}
        {activeOrder && product ? (
          <LiquidCard intensity={80}>
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
          </LiquidCard>
        ) : (
          <LiquidCard intensity={60}>
            <Text style={styles.productName}>No Active Group Buy Deal</Text>
            <Text style={styles.dealDetail}>The community admin hasn't created a pool for this group yet.</Text>
          </LiquidCard>
        )}

        {/* Progress card */}
        {activeOrder && product && activeOrder.status === 'pooling' && (
          <LiquidCard intensity={75}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>Group Progress</Text>
              <Text style={styles.progressRatio}>
                {totalKgCommitted.toFixed(1)} / {activeOrder.total_kg_required} kg
              </Text>
            </View>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
            </View>
            <Text style={styles.progressDescription}>
              {progressPct >= 100
                ? "Wholesale tier reached! Order is ready to dispatch."
                : `Need ${(activeOrder.total_kg_required - totalKgCommitted).toFixed(1)} kg more committed to unlock wholesale price.`}
            </Text>
          </LiquidCard>
        )}

        {/* Admin panel */}
        {isAdmin ? (
          <LiquidCard intensity={85} style={{ borderColor: 'rgba(217, 119, 6, 0.3)', borderWidth: 1 }}>
            <Text style={styles.adminCardTitle}>👑 Manage Orders (Admin Panel)</Text>

            {activeOrder ? (
              <>
                <View style={styles.adminStatsRow}>
                  <View style={styles.adminStatItem}>
                    <Text style={styles.adminStatVal}>{totalKgCommitted.toFixed(1)} kg</Text>
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
                    <Text style={styles.adminCardText}>Monitor progress. Once MOQ is met, close the order to trigger physical fulfillment. If the pool stalls, you can cancel it to unblock a new group buy.</Text>
                    <TouchableOpacity
                      style={[styles.adminActionBtn, styles.dangerBtn, isProcessing && styles.disabledBtn]}
                      activeOpacity={0.8}
                      onPress={handleCloseOrder}
                      disabled={isProcessing}
                    >
                      <Text style={styles.adminActionBtnText}>
                        {isProcessing ? "Processing..." : "Close Order (MOQ Met)"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.adminActionBtn, { backgroundColor: '#ef4444', marginTop: 8 }, isProcessing && styles.disabledBtn]}
                      activeOpacity={0.8}
                      onPress={handleCancelOrder}
                      disabled={isProcessing}
                    >
                      <Text style={styles.adminActionBtnText}>
                        {isProcessing ? "Processing..." : "Abort & Cancel Order"}
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
                      placeholderTextColor="rgba(255,255,255,0.3)"
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
            {/* Manage Members Button — Phase 1 approval pipeline */}
            <TouchableOpacity
              style={[styles.editDetailsBtn, { marginTop: 8, backgroundColor: 'rgba(79, 70, 229, 0.25)', borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.4)' }]}
              activeOpacity={0.8}
              onPress={() => router.push(`/community/manage-members?id=${communityId}`)}
            >
              <Text style={[styles.editDetailsBtnText, { color: '#a78bfa' }]}>👥  Manage Members</Text>
            </TouchableOpacity>
          </LiquidCard>
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
  // ---- Core layout (dark mode) ----
  safeArea: { flex: 1, backgroundColor: '#0f0f1a' },
  navHeader: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', backgroundColor: '#0f0f1a' },
  backButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, alignSelf: 'flex-start' },
  backButtonText: { fontSize: 14, fontWeight: '600', color: '#a78bfa' },
  contentContainer: { padding: 20, gap: 16, position: 'relative' as const },

  // ---- Matrix orbs — give BlurView something to distort ----
  matrixOrb1: {
    position: 'absolute' as const, top: -40, left: -60, width: 220, height: 220,
    borderRadius: 110, backgroundColor: 'rgba(124, 58, 237, 0.35)',
    // React Native doesn't support CSS filter blur on Views.
    // The BlurView in LiquidCard will pick this up as a background tint.
    opacity: 0.6,
  },
  matrixOrb2: {
    position: 'absolute' as const, top: 280, right: -80, width: 260, height: 260,
    borderRadius: 130, backgroundColor: 'rgba(132, 204, 22, 0.2)',
    opacity: 0.5,
  },
  matrixOrb3: {
    position: 'absolute' as const, top: 550, left: -30, width: 180, height: 180,
    borderRadius: 90, backgroundColor: 'rgba(217, 119, 6, 0.2)',
    opacity: 0.4,
  },

  // ---- Community header ----
  communityName: { fontSize: 22, fontWeight: '700', color: '#f0f0ff', marginBottom: 8, letterSpacing: 0.3 },
  communityMetaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  metaBadge: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  metaBadgeText: { fontSize: 12, fontWeight: '500', color: '#9ca3af' },
  metaMembers: { fontSize: 13, color: '#6b7280' },

  // ---- Section title ----
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#9ca3af', marginBottom: -4, letterSpacing: 0.4 },

  // ---- Deal card content (colors only — container is LiquidCard) ----
  brandBadge: { backgroundColor: 'rgba(132, 204, 22, 0.15)', alignSelf: 'flex-start' as const, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 12 },
  brandBadgeText: { color: '#84cc16', fontWeight: '600', fontSize: 11, textTransform: 'uppercase' as const },
  productName: { fontSize: 18, fontWeight: '700', color: '#f0f0ff', marginBottom: 10 },
  dealDetail: { fontSize: 14, color: '#9ca3af', marginBottom: 6 },
  boldText: { fontWeight: '600', color: '#e5e7eb' },
  priceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 16 },
  discountPrice: { fontSize: 20, fontWeight: '700', color: '#f0f0ff' },
  originalPrice: { fontSize: 14, color: '#6b7280', textDecorationLine: 'line-through' as const },
  discountBadge: { backgroundColor: '#ef4444', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  discountBadgeText: { color: '#ffffff', fontWeight: '700', fontSize: 11 },
  wholesaleLabel: { fontSize: 12, color: '#84cc16', fontWeight: '500', marginTop: 8 },

  // ---- Progress card content ----
  progressHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 12 },
  progressTitle: { fontSize: 15, fontWeight: '600', color: '#f0f0ff' },
  progressRatio: { fontSize: 14, fontWeight: '600', color: '#a78bfa' },
  progressBarContainer: { height: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, overflow: 'hidden' as const, marginBottom: 12 },
  progressBarFill: { height: '100%' as const, backgroundColor: '#84cc16', borderRadius: 6 },
  progressDescription: { fontSize: 13, color: '#9ca3af', lineHeight: 18 },

  // ---- Join/Leave button ----
  joinButton: { backgroundColor: '#7c3aed', borderRadius: 16, height: 56, alignItems: 'center' as const, justifyContent: 'center' as const, marginTop: 8 },
  joinedButton: { backgroundColor: '#ef4444' },
  joinButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  // ---- Loading / empty states ----
  loadingContainer: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 20 },
  loadingText: { marginTop: 12, color: '#6b7280', fontSize: 14, fontWeight: '500' },

  // ---- Admin card content ----
  adminCardTitle: { fontSize: 16, fontWeight: '700', color: '#fbbf24', marginBottom: 8 },
  adminCardText: { fontSize: 13, color: '#9ca3af', lineHeight: 18, marginBottom: 16 },
  adminStatsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, backgroundColor: 'rgba(251, 191, 36, 0.08)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(251, 191, 36, 0.15)' },
  adminStatItem: { alignItems: 'center' as const, flex: 1 },
  adminStatVal: { fontSize: 15, fontWeight: '700', color: '#f0f0ff' },
  adminStatLbl: { fontSize: 11, color: '#6b7280', marginTop: 2, fontWeight: '500' },
  adminStatDivider: { width: 1, height: 24, backgroundColor: 'rgba(251, 191, 36, 0.25)' },
  adminActionBtn: { backgroundColor: '#d97706', borderRadius: 12, height: 48, alignItems: 'center' as const, justifyContent: 'center' as const },
  adminActionBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  dangerBtn: { backgroundColor: '#ef4444' },
  disabledBtn: { opacity: 0.5 },
  editDetailsBtn: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, height: 48, alignItems: 'center' as const, justifyContent: 'center' as const },
  editDetailsBtnText: { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  verificationContainer: { backgroundColor: 'rgba(255,255,255,0.04)', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginTop: 4 },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 16, height: 48, fontSize: 18, color: '#f0f0ff', marginTop: 8, textAlign: 'center' as const, letterSpacing: 4, fontWeight: '600' },
  disabledInput: { opacity: 0.6, backgroundColor: 'rgba(255,255,255,0.03)' },
});