// Author: Adarsh Singh | Roll No: IC2025006
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
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { Community } from '../../lib/types';
import MatrixBackground from '@/components/MatrixBackground';
import LiquidCard from '@/components/LiquidCard';

interface CommunityCardProps {
  community: Community;
  currentUserId: string;
  onPress: (id: string) => void;
}

const CommunityCard = React.memo(({ community, currentUserId, onPress }: CommunityCardProps) => {
  const isAdmin = community.admin_uid === currentUserId;
  const memberCount = Array.isArray(community.members) ? community.members.length : 0;

  return (
    <LiquidCard intensity={40} style={styles.card}>
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
    </LiquidCard>
  );
});

export default function DashboardScreen() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // The Bouncer in index.tsx will automatically detect this and route you to /auth
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const uid = currentUser?.uid;

    if (!uid) {
      setMyCommunities([]);
      setLoading(false);
      return;
    }

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
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setMyCommunities(list);
        setLoading(false);
      },
      (error) => {
        console.error('Firestore Error:', error);
        signOut(auth);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid]);

  const handleViewCommunity = useCallback(
    (id: string) => {
      router.push(`/community/${id}`);
    },
    [router]
  );

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

  const keyExtractor = useCallback((item: Community) => item.id, []);

  const ListHeaderComponent = useMemo(
    () => (
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Dashboard</Text>
          <Text style={styles.headerSubtitle}>Communities you belong to</Text>
        </View>
        
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.logoutButton}
            activeOpacity={0.8}
            onPress={handleLogout}
          >
            <Text style={styles.logoutButtonText}>Sign Out</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.createButton}
            activeOpacity={0.8}
            onPress={() => router.push('/community/create')}
          >
            <Text style={styles.createButtonText}>+ Create</Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [router]
  );

  const ListEmptyComponent = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#7c3aed" />
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

  if (authLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={styles.loadingText}>Initializing authentication...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <MatrixBackground />
      <FlatList
        data={myCommunities}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={5}
        windowSize={3}
        maxToRenderPerBatch={5}
        removeClippedSubviews={true}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f1a',
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
    fontSize: 20,
    fontWeight: '700',
    color: '#f0f0ff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 6,
  },
  logoutButton: {
    backgroundColor: 'rgba(220, 38, 38, 0.1)', // Translucent glass red
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    justifyContent: 'center',
  },
  logoutButtonText: {
    color: '#ef4444',
    fontWeight: '600',
    fontSize: 12,
  },
  createButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  createButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 12,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },
  card: {
    borderRadius: 16,
    padding: 16,
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
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  locationBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9ca3af',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f0f0ff',
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
    marginBottom: 16,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 12,
  },
  memberCountText: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
  },
  viewButton: {
    backgroundColor: '#7c3aed',
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
    color: '#f0f0ff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 20,
  },
  browseButton: {
    backgroundColor: '#7c3aed',
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
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
});
