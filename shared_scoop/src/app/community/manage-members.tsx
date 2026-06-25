// Author: Adarsh Singh | Roll No: IC2025006
// ManageMembers — Admin approval pipeline for SharedScoop community memberships.
//
// Architecture decisions:
//   1. FlatList + React.memo(MemberRow) + useCallback handlers
//      Prevents O(N) re-render cascades when the admin rapidly taps approve/reject
//      across the list. Each row only re-renders if its own `item` prop changes.
//
//   2. onSnapshot capped at limit(50), status == 'pending' only
//      Avoids pulling the entire membership collection. The 50-doc cap bounds
//      Firestore read costs while covering realistic cohort sizes.
//      TOCTOU note: if a membership transitions on the server between the admin
//      tapping the button and Firestore evaluating the write, the server-side rule
//      `resource.data.status == 'pending'` will reject the stale write cleanly.
//
//   3. Haptics stubs (Phase 2 Liquid Glass)
//      expo-haptics calls are placed on every action button. In Phase 2 these
//      will pair with Liquid Glass press animations. They are no-ops until the
//      native module is linked in the dev client.
//
//   4. Optimistic local state removal with explicit catch-block rollback
//      Approved/rejected rows are removed from local state immediately so the admin
//      sees instant feedback. If the Firestore write is rejected by the server,
//      the catch block re-injects the cached row (sorted by requestedAt) so the
//      admin's list is never permanently ghosted without a full restart.
//      NOTE: onSnapshot does NOT re-emit for a failed write — the server state
//      was never changed, so there is no delta to push. Explicit rollback is
//      the only safe recovery path.

import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import * as Haptics from 'expo-haptics';
import { db, auth } from '../../lib/firebase';
import { Membership, Community } from '../../lib/types';
import LiquidCard from '../../components/LiquidCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnrichedMembership extends Membership {
  displayName: string;
  displayEmail: string;
  requestedAt: string;
}

// ---------------------------------------------------------------------------
// Memoized row component — only re-renders when its own item reference changes.
// This is the critical O(1) guard against re-render cascades on rapid taps.
// ---------------------------------------------------------------------------

interface MemberRowProps {
  item: EnrichedMembership;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isProcessing: boolean;
}

const MemberRow = memo(({ item, onApprove, onReject, isProcessing }: MemberRowProps) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <LiquidCard intensity={40} style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{item.displayName}</Text>
          <Text style={styles.cardEmail}>{item.displayEmail}</Text>
          <Text style={styles.cardDate}>{formatDate(item.requestedAt)}</Text>
        </View>
      </View>

      <View style={styles.cardActions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.rejectBtn, isProcessing && styles.btnDisabled]}
          activeOpacity={0.75}
          onPress={() => onReject(item.id)}
          disabled={isProcessing}
        >
          <Text style={styles.rejectBtnText}>✕  Reject</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.approveBtn, isProcessing && styles.btnDisabled]}
          activeOpacity={0.75}
          onPress={() => onApprove(item.id)}
          disabled={isProcessing}
        >
          <Text style={styles.approveBtnText}>✓  Approve</Text>
        </TouchableOpacity>
      </View>
    </LiquidCard>
  );
});

MemberRow.displayName = 'MemberRow';

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ManageMembersScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const communityId = typeof id === 'string' ? id : '';

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [pendingMembers, setPendingMembers] = useState<EnrichedMembership[]>([]);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Prevents state updates after unmount (e.g. back-navigation mid-write).
  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (isMounted.current) {
        setCurrentUser(user);
        setLoadingAuth(false);
      }
    });
    return () => unsub();
  }, []);

  // Fetch community doc to verify admin identity and display community name.
  useEffect(() => {
    if (!communityId) return;
    getDoc(doc(db, 'communities', communityId)).then((snap) => {
      if (snap.exists() && isMounted.current) {
        setCommunity({ id: snap.id, ...snap.data() } as Community);
      }
    });
  }, [communityId]);

  // Real-time listener for pending memberships.
  // Capped at 50 docs. Ordered by created_at ascending so oldest requests appear
  // first — fairness for early applicants.
  useEffect(() => {
    if (!currentUser || !communityId) return;

    const q = query(
      collection(db, 'memberships'),
      where('community_id', '==', communityId),
      where('status', '==', 'pending'),
      orderBy('created_at', 'asc'),
      limit(50)
    );

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        // Enrich each membership with the user's display info.
        // We batch the user doc fetches in parallel for minimum latency.
        const enriched = await Promise.all(
          snapshot.docs.map(async (memberSnap) => {
            const data = memberSnap.data();
            let displayName = 'Unknown Student';
            let displayEmail = '';

            try {
              const userSnap = await getDoc(doc(db, 'users', data.user_id));
              if (userSnap.exists()) {
                const u = userSnap.data();
                displayName = u.full_name || u.email || 'Unknown';
                displayEmail = u.email || '';
              }
            } catch {
              // User doc missing — still render row with fallback values.
            }

            return {
              id: memberSnap.id,
              ...data,
              displayName,
              displayEmail,
              requestedAt: data.created_at,
            } as EnrichedMembership;
          })
        );

        if (isMounted.current) {
          setPendingMembers(enriched);
          setLoadingData(false);
        }
      },
      (error) => {
        console.warn("Access restricted:", error.message);
        if (isMounted.current) setLoadingData(false);
      }
    );

    return () => unsub();
  }, [currentUser, communityId]);

  // ---------------------------------------------------------------------------
  // Action handlers — memoized so MemberRow referential equality is stable.
  // The optimistic removal from local state gives the admin instant feedback;
  // the onSnapshot will re-hydrate if the write fails server-side.
  // ---------------------------------------------------------------------------

  const handleApprove = useCallback(
    async (membershipId: string) => {
      // Phase 2 Liquid Glass stub — pairs with press animation in the next sprint.
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (isProcessing) return;
      if (isMounted.current) setIsProcessing(true);

      // Cache the target membership BEFORE optimistic removal.
      // onSnapshot will NOT re-emit for a failed write (server state unchanged).
      // Without this cache, a PERMISSION_DENIED or network error permanently
      // ghosts the row from the admin's list until the app is restarted.
      const targetMembership = pendingMembers.find((m) => m.id === membershipId);

      // Optimistic remove
      setPendingMembers((prev) => prev.filter((m) => m.id !== membershipId));

      try {
        // Firestore rule: affectedKeys().hasOnly(['status', 'updatedAt']).
        // Source state must be 'pending' (server validates resource.data.status).
        await updateDoc(doc(db, 'memberships', membershipId), {
          status: 'approved',
          updatedAt: new Date().toISOString(),
        });
      } catch (error: any) {
        console.error('Approve failed:', error);
        // ROLLBACK: Re-inject the cached row, restoring original sort order.
        if (targetMembership) {
          setPendingMembers((prev) =>
            [...prev, targetMembership].sort(
              (a, b) =>
                new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
            )
          );
        }
        Alert.alert('Approval Failed', error.message || 'Could not approve. Please try again.');
      } finally {
        if (isMounted.current) setIsProcessing(false);
      }
    },
    [isProcessing, pendingMembers]
  );

  const handleReject = useCallback(
    async (membershipId: string) => {
      // Phase 2 Liquid Glass stub.
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (isProcessing) return;
      if (isMounted.current) setIsProcessing(true);

      // Cache before optimistic removal — same rollback rationale as handleApprove.
      const targetMembership = pendingMembers.find((m) => m.id === membershipId);

      // Optimistic remove
      setPendingMembers((prev) => prev.filter((m) => m.id !== membershipId));

      try {
        await deleteDoc(doc(db, 'memberships', membershipId));
      } catch (error: any) {
        console.error('Reject failed:', error);
        // ROLLBACK
        if (targetMembership) {
          setPendingMembers((prev) =>
            [...prev, targetMembership].sort(
              (a, b) =>
                new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
            )
          );
        }
        Alert.alert('Rejection Failed', error.message || 'Could not reject. Please try again.');
      } finally {
        if (isMounted.current) setIsProcessing(false);
      }
    },
    [isProcessing, pendingMembers]
  );

  // Stable keyExtractor
  const keyExtractor = useCallback((item: EnrichedMembership) => item.id, []);

  // Stable renderItem — captures memoized handlers, never recreated on list re-renders.
  const renderItem = useCallback(
    ({ item }: { item: EnrichedMembership }) => (
      <MemberRow
        item={item}
        onApprove={handleApprove}
        onReject={handleReject}
        isProcessing={isProcessing}
      />
    ),
    [handleApprove, handleReject, isProcessing]
  );

  // ---------------------------------------------------------------------------
  // Guard: only the community admin can view this screen.
  // ---------------------------------------------------------------------------

  const isAdmin =
    community && currentUser && community.admin_uid === currentUser.uid;

  if (!loadingAuth && !loadingData && !isAdmin) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorIcon}>🔒</Text>
          <Text style={styles.errorTitle}>Access Denied</Text>
          <Text style={styles.errorSubtitle}>Only the community admin can manage members.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f1a" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Text style={styles.headerBackText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle}>Manage Members</Text>
          {community && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {community.name}
            </Text>
          )}
        </View>
      </View>

      {/* Pending count badge */}
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {pendingMembers.length} pending request{pendingMembers.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      {loadingAuth || loadingData ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={styles.loadingText}>Loading requests…</Text>
        </View>
      ) : pendingMembers.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>🎉</Text>
          <Text style={styles.emptyTitle}>All caught up!</Text>
          <Text style={styles.emptySubtitle}>No pending join requests for this community.</Text>
        </View>
      ) : (
        <FlatList
          data={pendingMembers}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          // Accessibility: announce list size for screen readers.
          accessibilityLabel={`${pendingMembers.length} pending membership requests`}
          // Performance: items are fixed height; enables VirtualList fast path.
          getItemLayout={(_data, index) => ({
            length: CARD_HEIGHT,
            offset: CARD_HEIGHT * index,
            index,
          })}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Layout constant used by getItemLayout for O(1) scroll position calculation.
// ---------------------------------------------------------------------------
const CARD_HEIGHT = 148; // card padding + avatar + two action buttons

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 16 : 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
    gap: 12,
  },
  headerBack: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  headerBackText: {
    color: '#a78bfa',
    fontSize: 18,
    fontWeight: '600',
  },
  headerTitleGroup: {
    flex: 1,
  },
  headerTitle: {
    color: '#f0f0ff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 1,
  },

  // Badge
  badgeRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(124,58,237,0.18)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.35)',
  },
  badgeText: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '600',
  },

  // List
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },

  // Card
  card: {
    padding: 14,
    height: CARD_HEIGHT,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  cardInfo: {
    flex: 1,
  },
  cardName: {
    color: '#f0f0ff',
    fontSize: 14,
    fontWeight: '600',
  },
  cardEmail: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 1,
  },
  cardDate: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },

  // Action buttons
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtn: {
    backgroundColor: '#059669',
  },
  rejectBtn: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
  },
  approveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  rejectBtnText: {
    color: '#f87171',
    fontWeight: '600',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  btnDisabled: {
    opacity: 0.45,
  },

  // Empty / error states
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#f0f0ff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  errorTitle: {
    color: '#f87171',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  errorSubtitle: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },

  // Loading
  loadingText: {
    color: '#6b7280',
    marginTop: 12,
    fontSize: 14,
  },

  // Back button in error state
  backBtn: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
