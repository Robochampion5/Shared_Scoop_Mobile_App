// Author: Adarsh Singh | Roll No: IC2025006
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar, ActivityIndicator, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot, query, collection, where, limit, updateDoc, arrayUnion } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { Community, Order } from '@/lib/types';
import MatrixBackground from '@/components/MatrixBackground';
import LiquidCard from '@/components/LiquidCard';

export default function CommunityHubScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const communityId = typeof id === 'string' ? id : '';

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!communityId) return;

    setLoading(true);
    
    // Listen to Community
    const unsubCommunity = onSnapshot(doc(db, 'communities', communityId), 
      (docSnap) => {
        if (docSnap.exists()) {
          setCommunity({ id: docSnap.id, ...docSnap.data() } as Community);
        }
      }, 
      (error) => { 
        console.warn("Access restricted:", error.message); 
      }
    );

    // Listen to Active Pooling Order
    const q = query(
      collection(db, 'orders'),
      where('community_id', '==', communityId),
      where('status', '==', 'pooling'),
      limit(1)
    );
    
    const unsubOrder = onSnapshot(q, 
      (snapshot) => {
        if (!snapshot.empty) {
          setOrder({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Order);
        } else {
          setOrder(null);
        }
        setLoading(false);
      },
      (error) => {
        console.warn("Access restricted:", error.message);
        setLoading(false);
      }
    );

    return () => {
      unsubCommunity();
      unsubOrder();
    };
  }, [communityId]);

  const handleJoinCommunity = async () => {
    if (!currentUser?.uid || !communityId) return;
    try {
      await updateDoc(doc(db, 'communities', communityId), { 
        members: arrayUnion(currentUser.uid) 
      });
    } catch (error: any) {
      console.error("Error joining community:", error);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#7c3aed" />
        </View>
      </SafeAreaView>
    );
  }

  if (!community) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Community not found or access restricted.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isAdmin = currentUser?.uid === community.admin_uid;
  const isMember = community?.members?.includes(currentUser?.uid || '');
  const memberCount = Array.isArray(community.members) ? community.members.length : 0;
  
  const totalCommitted = order?.total_kg_committed || 0;
  const totalRequired = order?.total_kg_required || 15;
  const progressPercent = Math.min((totalCommitted / totalRequired) * 100, 100);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <MatrixBackground />
      
      <View style={styles.navHeader}>
        <TouchableOpacity style={styles.navBackButton} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.navBackButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Community Hub</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Panel 1 (Info) */}
        <LiquidCard intensity={40} style={styles.panelCard}>
          <View style={styles.panelHeader}>
            <View style={styles.communityIconContainer}>
              <Text style={styles.communityIconText}>👥</Text>
            </View>
            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>📍 {community.location_area}</Text>
            </View>
          </View>
          <Text style={styles.communityName}>{community.name}</Text>
          <Text style={styles.communityDesc}>{community.description}</Text>
          <Text style={styles.memberCountText}>👥 {memberCount} members</Text>
        </LiquidCard>

        {/* Panel 2 (Pledge Tracker) */}
        {order ? (
          <LiquidCard intensity={40} style={styles.panelCard}>
            <Text style={styles.panelTitle}>Active Order Pledge</Text>
            <Text style={styles.progressText}>{totalCommitted}kg / {totalRequired}kg MOQ</Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
            </View>
          </LiquidCard>
        ) : (
          <LiquidCard intensity={40} style={styles.panelCard}>
            <Text style={styles.panelTitle}>No Active Order</Text>
            <Text style={styles.communityDesc}>There is currently no pooling order for this community.</Text>
          </LiquidCard>
        )}

        {/* Panel 3 (Actions) */}
        <LiquidCard intensity={40} style={styles.panelCard}>
          <Text style={styles.panelTitle}>Actions</Text>
          
          {!isMember ? (
            <TouchableOpacity 
              style={styles.joinActionBtn} 
              activeOpacity={0.8}
              onPress={handleJoinCommunity}
            >
              <Text style={styles.primaryActionBtnText}>Join Group Buy</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={styles.primaryActionBtn} 
              activeOpacity={0.8}
              onPress={() => router.push(`/community/chat/${communityId}`)}
            >
              <Text style={styles.primaryActionBtnText}>Enter Community Chat</Text>
            </TouchableOpacity>
          )}

          {isAdmin && (
            <TouchableOpacity 
              style={styles.secondaryActionBtn} 
              activeOpacity={0.8}
              onPress={() => router.push(`/community/edit/${communityId}`)}
            >
              <Text style={styles.secondaryActionBtnText}>Admin: Manage Order</Text>
            </TouchableOpacity>
          )}
        </LiquidCard>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#f0f0ff',
    fontSize: 16,
    marginBottom: 16,
  },
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
  },
  backButtonText: {
    color: '#a78bfa',
    fontWeight: '600',
  },
  navHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(15, 15, 26, 0.9)',
  },
  navBackButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
  },
  navBackButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a78bfa',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f0f0ff',
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  panelCard: {
    padding: 20,
    borderRadius: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  communityIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(132, 204, 22, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityIconText: {
    fontSize: 24,
  },
  locationBadge: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  locationBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
  },
  communityName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f0f0ff',
    marginBottom: 8,
  },
  communityDesc: {
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
    marginBottom: 16,
  },
  memberCountText: {
    fontSize: 13,
    color: '#a78bfa',
    fontWeight: '600',
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#f0f0ff',
    marginBottom: 12,
  },
  progressText: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 10,
    fontWeight: '500',
  },
  progressBarTrack: {
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#84cc16',
    borderRadius: 6,
  },
  primaryActionBtn: {
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  joinActionBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryActionBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryActionBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  secondaryActionBtnText: {
    color: '#f0f0ff',
    fontSize: 15,
    fontWeight: '600',
  },
});