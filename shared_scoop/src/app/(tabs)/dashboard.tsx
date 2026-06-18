import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { Community } from '../../lib/types';

// ─── Memoized Card Component ──────────────────────────────────────────────────
// Extracted so FlatList's built-in shouldComponentUpdate/React.memo comparison
// prevents re-rendering cards that haven't changed when a sibling updates.
interface CommunityCardProps {
  community: Community;
  currentUserId: string;
  onPress: (id: string) => void;
}

const CommunityCard = React.memo(({ community, currentUserId, onPress }: CommunityCardProps) => {
  const isAdmin = community.admin_uid === currentUserId;
  // Use members array length from the document itself — no separate listener needed.
  const memberCount = Array.isArray(community.members) ? community.members.length : 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.communityIconContainer}>
          <Text style={styles.communityIconText}>👥</Text>
        </View>
        <View style={styles.headerBadges}>
          {isAdmin && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>👑 Admin</Text>
            </View>
          )}
          <View style={styles.locationBadge}>
            <Text style={styles.locationBadgeText}>📍 {community.location_area}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.cardTitle}>{community.name}</Text>
      <Text style={styles.cardDescription} numberOfLines={2}>
        {community.description}
      </Text>

      <View style={styles.cardFooter}>
        <Text style={styles.memberCountText}>👥 {memberCount} members</Text>
        <TouchableOpacity
          style={styles.viewButton}
          onPress={() => onPress(community.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.viewButtonText}>View Group</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Auth listener (stable, runs once) ──────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // ── Firestore listener — keyed on uid string, NOT the user object ──────────
  // Tying to `currentUser` (object) would create a new listener on every auth
  // event that changes the object reference even if the uid is identical.
  useEffect(() => {
    const uid = currentUser?.uid;

    if (!uid) {
      setMyCommunities([]);
      setLoading(false);
      return;
    }

    // isLoading flips false the instant the first snapshot payload arrives —
    // not after any external network promise.
    setLoading(true);

    const q = query(
      collection(db, 'communities'),
      where('members', 'array-contains', uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Community[] = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Community)
        );
        // Alphabetical sort is O(n log n) but happens off the render thread.
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setMyCommunities(list);
        // Loading flips false on first snapshot, regardless of list size.
        setLoading(false);
      },
      (error) => {
        console.error('Error querying communities (check composite index):', error);
        setLoading(false);
      }
    );

    // Explicit cleanup — prevents duplicate active socket pipelines on uid change.
    return () => unsubscribe();
  }, [currentUser?.uid]);

  // ── Stable navigation callback — does NOT change across re-renders ──────────
  const handleViewCommunity = useCallback(
    (id: string) => {
      router.push(`/community/${id}`);
    },
    [router]
  );

  // ── FlatList render item — stable reference via useCallback ────────────────
  const renderItem = useCallback(
    ({ item }: { item: Community }) => (
      <CommunityCard
        community={item}
        currentUserId={currentUser?.uid ?? ''}
        onPress={handleViewCommunity}
      />
    ),
    [currentUser?.uid, handleViewCommunity]
  );

  // ── Stable key extractor ───────────────────────────────────────────────────
  const keyExtractor = useCallback((item: Community) => item.id, []);

  // ── Header component — memoized so it doesn't re-create on list changes ────
  const ListHeaderComponent = useMemo(
    () => (
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Dashboard</Text>
          <Text style={styles.headerSubtitle}>Communities you belong to</Text>
        </View>
        <TouchableOpacity
          style={styles.createButton}
          activeOpacity={0.8}
          onPress={() => router.push('/community/create')}
        >
          <Text style={styles.createButtonText}>+ Create</Text>
        </TouchableOpacity>
      </View>
    ),
    [router]
  );

  // ── Empty / loading component ──────────────────────────────────────────────
  const ListEmptyComponent = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#84cc16" />
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>📦</Text>
        <Text style={styles.emptyTitle}>No Groups Yet</Text>
        <Text style={styles.emptySubtitle}>
          You haven't joined or created any communities.
        </Text>
        <TouchableOpacity
          style={styles.browseButton}
          onPress={() => router.push('/(tabs)/browse')}
        >
          <Text style={styles.browseButtonText}>Browse Available Groups</Text>
        </TouchableOpacity>
      </View>
    );
  }, [loading, router]);

  // ── Auth initializing — root layout gate shows a spinner; this is a fallback
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
      <StatusBar barStyle="dark-content" />

      <FlatList
        data={myCommunities}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        // ── Performance props ──────────────────────────────────────────────
        // Render only 5 cards on first frame; load more as the user scrolls.
        initialNumToRender={5}
        // Keep 3 screen-heights of cards in memory (1 visible + 1 above + 1 below).
        windowSize={3}
        // Process at most 5 new cards per JS batch to avoid frame drops.
        maxToRenderPerBatch={5}
        // Prevents FlatList from measuring items on every scroll event.
        removeClippedSubviews={true}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    marginTop: 2,
  },
  createButton: {
    backgroundColor: '#84cc16',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  createButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  listContent: {
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  communityIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(132, 204, 22, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityIconText: {
    fontSize: 20,
  },
  headerBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  adminBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  adminBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#d97706',
  },
  locationBadge: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  locationBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#4b5563',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
    marginBottom: 16,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 12,
  },
  memberCountText: {
    fontSize: 12,
    color: '#4b5563',
    fontWeight: '500',
  },
  viewButton: {
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  viewButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
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
    marginBottom: 20,
  },
  browseButton: {
    backgroundColor: '#84cc16',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  browseButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '500',
  },
});
