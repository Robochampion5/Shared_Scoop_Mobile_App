import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '../../lib/firebase';
import MatrixBackground from '../../components/MatrixBackground';
import LiquidCard from '../../components/LiquidCard';
import PaymentTicket from '../../components/PaymentTicket';

interface JoinedCommitment {
  id: string;
  contribution: any;
  order: any | null;
  product: any | null;
}

// ─── Status priority for sort ─────────────────────────────────────────────────
// paid / fulfilled sit at the top (most actionable), delivered at the bottom
const STATUS_PRIORITY: Record<string, number> = {
  paid: 0,
  fulfilled: 1,
  pending: 2,
  delivered: 3,
};

function statusPriority(status: string): number {
  return STATUS_PRIORITY[status] ?? 2;
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function CommitmentsScreen() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [commitments, setCommitments] = useState<JoinedCommitment[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Auth listener ─────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Contributions listener ────────────────────────────────────────────────
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

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        if (snapshot.empty) {
          setCommitments([]);
          setLoading(false);
          return;
        }

        // Join order + product per contribution (one-time read, not N+1 in listener)
        const promises = snapshot.docs.map(async (docSnap) => {
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
          } catch (e) {
            console.error('Join failed for contribution:', docSnap.id, e);
          }
          return { id: docSnap.id, contribution: contribData, order: orderData, product: productData } as JoinedCommitment;
        });

        const resolved = await Promise.all(promises);

        // Sort: paid → fulfilled → pending → delivered
        resolved.sort((a, b) =>
          statusPriority(a.contribution.status) - statusPriority(b.contribution.status)
        );

        setCommitments(resolved);
        setLoading(false);
      },
      (err) => {
        console.warn('Commitments restricted:', err.message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUser?.uid]);

  // ─── Render Item ───────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: JoinedCommitment }) => {
      const { contribution, order, product } = item;
      const status: string = contribution.status ?? 'pending';
      const isPaid = status === 'paid';
      const isFulfilled = status === 'fulfilled';
      const isDelivered = status === 'delivered';
      const isOrderCompleted = order?.status === 'completed';

      // ── Status badge meta ──────────────────────────────────────────────────
      type BadgeConfig = { label: string; bg: string; color: string };
      const badge: BadgeConfig = isPaid
        ? { label: '💳 Paid — Show QR', bg: 'rgba(124,58,237,0.2)', color: '#a78bfa' }
        : isFulfilled
        ? { label: '✅ Fulfilled', bg: 'rgba(52,211,153,0.15)', color: '#34d399' }
        : isDelivered
        ? { label: 'Delivered', bg: 'rgba(255,255,255,0.08)', color: '#9ca3af' }
        : isOrderCompleted
        ? { label: 'Ready for Pickup', bg: 'rgba(22,163,74,0.2)', color: '#16a34a' }
        : { label: 'Awaiting MOQ', bg: 'rgba(217,119,6,0.2)', color: '#d97706' };

      return (
        <LiquidCard intensity={40} style={[styles.card, isDelivered ? styles.cardDelivered : {}] as any}>
          {/* ── Card Header ───────────────────────────────────────────────── */}
          <View style={styles.cardHeader}>
            <Text style={styles.productName} numberOfLines={2}>
              {product?.name ?? 'Unknown Product'}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.statusText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          </View>

          {/* ── Details row ───────────────────────────────────────────────── */}
          <View style={styles.detailsRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Committed</Text>
              <Text style={styles.detailValue}>{contribution.kg_committed} kg</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Amount Paid</Text>
              <Text style={styles.detailValue}>₹{contribution.amount_paid ?? '—'}</Text>
            </View>
          </View>

          {/* ── QR Payment Ticket ─────────────────────────────────────────────
               Rendered when status === 'paid'.
               Wrapped in a Liquid Glass BlurView to isolate it from the card. */}
          {isPaid && currentUser && (
            <View style={styles.ticketWrapper}>
              <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={styles.ticketBorder} />
              <View style={styles.ticketInner}>
                <Text style={styles.ticketPrompt}>
                  📲 Present this QR at the distribution hub
                </Text>
                <PaymentTicket
                  orderId={contribution.order_id}
                  userId={currentUser.uid}
                  kgCommitted={contribution.kg_committed}
                  memberName={currentUser.displayName ?? undefined}
                />
              </View>
            </View>
          )}

          {/* ── Fulfilled badge (replaces QR after admin scan) ────────────────
               Shows a green check with the fulfillment timestamp. */}
          {isFulfilled && (
            <View style={styles.fulfilledBadge}>
              <Text style={styles.fulfilledIcon}>✅</Text>
              <View>
                <Text style={styles.fulfilledTitle}>Collected at Hub</Text>
                {contribution.fulfilled_at ? (
                  <Text style={styles.fulfilledTime}>
                    {new Date(contribution.fulfilled_at).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                ) : null}
              </View>
            </View>
          )}

          {/* ── Legacy OTP pickup token (status === completed order) ──────── */}
          {!isDelivered && !isPaid && !isFulfilled && isOrderCompleted && contribution.delivery_otp && (
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
    },
    [currentUser]
  );

  // ─── Loading ───────────────────────────────────────────────────────────────
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

  // ─── Main View ─────────────────────────────────────────────────────────────
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
        // Performance tuning (cards can be tall when QR is visible)
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🛒</Text>
            <Text style={styles.emptyTitle}>No Commitments Yet</Text>
            <Text style={styles.emptySubtitle}>
              Browse pools and make your first pledge to get started.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
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

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f0f0ff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
  },

  // List
  listContainer: {
    paddingHorizontal: 16,
    paddingBottom: 100, // clear tab bar
    gap: 14,
    flexGrow: 1,
  },

  // Commitment card
  card: {
    borderRadius: 16,
    padding: 16,
  },
  cardDelivered: {
    opacity: 0.55,
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
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Details row
  detailsRow: {
    flexDirection: 'row',
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 12,
    marginBottom: 4,
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f0f0ff',
  },

  // ── QR Payment Ticket wrapper ────────────────────────────────────────────────
  // Liquid Glass isolation layer — BlurView fills absolutely, border on top
  ticketWrapper: {
    marginTop: 16,
    borderRadius: 20,
    overflow: 'hidden',
  },
  ticketBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  ticketInner: {
    padding: 16,
  },
  ticketPrompt: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.3,
  },

  // ── Fulfilled badge ──────────────────────────────────────────────────────────
  fulfilledBadge: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.2)',
    borderRadius: 16,
    padding: 16,
  },
  fulfilledIcon: {
    fontSize: 28,
  },
  fulfilledTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#34d399',
    marginBottom: 2,
  },
  fulfilledTime: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },

  // ── Legacy OTP block ─────────────────────────────────────────────────────────
  otpContainer: {
    marginTop: 16,
    backgroundColor: 'rgba(17,24,39,0.8)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  otpLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
    textTransform: 'uppercase',
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

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f0f0ff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
});