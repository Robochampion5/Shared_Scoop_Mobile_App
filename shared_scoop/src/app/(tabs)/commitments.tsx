import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, FlatList, ActivityIndicator, StatusBar } from 'react-native';
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '../../lib/firebase';
import { useRouter } from 'expo-router';
import MatrixBackground from '../../components/MatrixBackground';
import LiquidCard from '../../components/LiquidCard';

interface JoinedCommitment {
  id: string;
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

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

      const joinedDataPromises = snapshot.docs.map(async (docSnap) => {
        const contribData = docSnap.data();
        let orderData: any = null;
        let productData: any = null;

        try {
          if (contribData.order_id) {
            const orderSnap = await getDoc(doc(db, 'orders', contribData.order_id));
            if (orderSnap.exists()) {
              orderData = { id: orderSnap.id, ...orderSnap.data() };

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
      
      resolvedData.sort((a, b) => {
        if (a.contribution.status === 'delivered' && b.contribution.status !== 'delivered') return 1;
        if (a.contribution.status !== 'delivered' && b.contribution.status === 'delivered') return -1;
        return 0;
      });

      setCommitments(resolvedData);
      setLoading(false);
    }, (error) => {
      console.warn("Access restricted:", error.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser?.uid]);

  const renderItem = useCallback(({ item }: { item: JoinedCommitment }) => {
    const { contribution, order, product } = item;
    
    const isDelivered = contribution.status === 'delivered';
    const isOrderCompleted = order?.status === 'completed';

    return (
      <LiquidCard intensity={40} style={[styles.card, isDelivered ? styles.cardDelivered : {}]}>
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

        {!isDelivered && isOrderCompleted && contribution.delivery_otp && (
          <View style={styles.otpContainer}>
            <Text style={styles.otpLabel}>SECURE PICKUP TOKEN</Text>
            <Text style={styles.otpValue}>{contribution.delivery_otp}</Text>
            <Text style={styles.otpInstruction}>
              Show this code to the community admin to receive your physical protein.
            </Text>
          </View>
        )}
      </LiquidCard>
    );
  }, []);

  if (authLoading || loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={styles.loadingText}>Loading your commitments...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <MatrixBackground />
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
    backgroundColor: '#0f0f1a',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#9ca3af',
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
    color: '#f0f0ff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    padding: 16,
  },
  cardDelivered: {
    opacity: 0.6,
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
    color: '#f0f0ff',
    marginRight: 12,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgePending: {
    backgroundColor: 'rgba(217, 119, 6, 0.2)',
  },
  badgeActionable: {
    backgroundColor: 'rgba(22, 163, 74, 0.2)',
  },
  badgeSuccess: {
    backgroundColor: 'rgba(255,255,255,0.1)',
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
    color: '#9ca3af',
  },
  detailsRow: {
    flexDirection: 'row',
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 12,
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f0f0ff',
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
    fontSize: 12,
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
    color: '#f0f0ff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
});