import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, FlatList, ActivityIndicator, StatusBar } from 'react-native';
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { useRouter } from 'expo-router';

// Define localized types for the joined data structure
interface JoinedCommitment {
  id: string; // Contribution ID
  contribution: any;
  order: any | null;
  product: any | null;
}

export default function CommitmentsScreen() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [commitments, setCommitments] = useState<JoinedCommitment[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Auth Gate
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Real-time Relational Listener
  useEffect(() => {
    if (!currentUser?.uid) {
      setCommitments([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'contributions'),
      where('user_id', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      if (snapshot.empty) {
        setCommitments([]);
        setLoading(false);
        return;
      }

    // Resolve NoSQL relations manually for the UI
      const joinedDataPromises = snapshot.docs.map(async (docSnap) => {
        const contribData = docSnap.data();
        
        // FIX: Explicitly type these to prevent TypeScript from locking them as 'null'
        let orderData: any = null;
        let productData: any = null;

        try {
          // Fetch associated order
          if (contribData.order_id) {
            const orderSnap = await getDoc(doc(db, 'orders', contribData.order_id));
            if (orderSnap.exists()) {
              orderData = { id: orderSnap.id, ...orderSnap.data() };

              // Fetch associated product using safe optional chaining
              if (orderData?.product_id) {
                const productSnap = await getDoc(doc(db, 'products', orderData.product_id));
                if (productSnap.exists()) {
                  productData = { id: productSnap.id, ...productSnap.data() };
                }
              }
            }
          }
        } catch (error) {
          console.error("Failed to fetch relational data for contribution:", error);
        }

        return {
          id: docSnap.id,
          contribution: contribData,
          order: orderData,
          product: productData,
        } as JoinedCommitment;
      });

      const resolvedData = await Promise.all(joinedDataPromises);
      
      // Sort: Pending/Pooling at top, Delivered at bottom
      resolvedData.sort((a, b) => {
        if (a.contribution.status === 'delivered' && b.contribution.status !== 'delivered') return 1;
        if (a.contribution.status !== 'delivered' && b.contribution.status === 'delivered') return -1;
        return 0;
      });

      setCommitments(resolvedData);
      setLoading(false);
    }, (error) => {
      console.error("Contributions listener failed:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser?.uid]);

  // 3. Render Individual Commitment Card
  const renderItem = useCallback(({ item }: { item: JoinedCommitment }) => {
    const { contribution, order, product } = item;
    
    const isDelivered = contribution.status === 'delivered';
    const isOrderCompleted = order?.status === 'completed';

    return (
      <View style={[styles.card, isDelivered && styles.cardDelivered]}>
        <View style={styles.cardHeader}>
          <Text style={styles.productName}>
            {product?.name || "Unknown Product"}
          </Text>
          <View style={[
            styles.statusBadge, 
            isDelivered ? styles.badgeSuccess : 
            isOrderCompleted ? styles.badgeActionable : 
            styles.badgePending
          ]}>
            <Text style={[
              styles.statusText,
              isDelivered ? styles.textSuccess : 
              isOrderCompleted ? styles.textActionable : 
              styles.textPending
            ]}>
              {isDelivered ? "Delivered" : isOrderCompleted ? "Ready for Pickup" : "Awaiting MOQ"}
            </Text>
          </View>
        </View>

        <View style={styles.detailsRow}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Committed</Text>
            <Text style={styles.detailValue}>{contribution.kg_committed} kg</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Amount Paid</Text>
            <Text style={styles.detailValue}>₹{contribution.amount_paid}</Text>
          </View>
        </View>

        {/* The Fulfillment OTP Block - Strictly Conditional */}
        {!isDelivered && isOrderCompleted && contribution.delivery_otp && (
          <View style={styles.otpContainer}>
            <Text style={styles.otpLabel}>SECURE PICKUP TOKEN</Text>
            <Text style={styles.otpValue}>{contribution.delivery_otp}</Text>
            <Text style={styles.otpInstruction}>
              Show this code to the community admin to receive your physical protein.
            </Text>
          </View>
        )}
      </View>
    );
  }, []);

  if (authLoading || loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#84cc16" />
          <Text style={styles.loadingText}>Loading your commitments...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Protein</Text>
        <Text style={styles.headerSubtitle}>Track your active and completed group buys</Text>
      </View>

      <FlatList
        data={commitments}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🛒</Text>
            <Text style={styles.emptyTitle}>No Commitments Found</Text>
            <Text style={styles.emptySubtitle}>You haven't joined any protein pools yet.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '500',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardDelivered: {
    opacity: 0.6,
    backgroundColor: '#f3f4f6',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  productName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginRight: 12,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgePending: {
    backgroundColor: '#fef3c7',
  },
  badgeActionable: {
    backgroundColor: '#dcfce7',
  },
  badgeSuccess: {
    backgroundColor: '#e5e7eb',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  textPending: {
    color: '#d97706',
  },
  textActionable: {
    color: '#16a34a',
  },
  textSuccess: {
    color: '#4b5563',
  },
  detailsRow: {
    flexDirection: 'row',
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 12,
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  otpContainer: {
    marginTop: 16,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  otpLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  otpValue: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 8,
    marginBottom: 8,
  },
  otpInstruction: {
    color: '#d1d5db',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
});