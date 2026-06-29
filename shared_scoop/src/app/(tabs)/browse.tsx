import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet, SafeAreaView, StatusBar, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Community } from '../../lib/types';
import MatrixBackground from '../../components/MatrixBackground';
import LiquidCard from '../../components/LiquidCard';

const LOCATIONS = ["All", "Koramangala", "Whitefield", "Indiranagar", "HSR Layout", "Marathahalli", "Jayanagar"];

export default function BrowseCommunitiesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("All");

  const [communities, setCommunities] = useState<Community[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const communitiesRef = collection(db, "communities");
    const unsubscribe = onSnapshot(communitiesRef, (snapshot) => {
      const list: Community[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Community);
      });
      setCommunities(list);
      setLoading(false);
    }, (error) => {
      console.warn("Access restricted:", error.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const membershipsQuery = query(
      collection(db, "memberships"),
      where("status", "==", "approved")
    );
    const unsubscribe = onSnapshot(membershipsQuery, (snapshot) => {
      const counts: Record<string, number> = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.community_id) {
          counts[data.community_id] = (counts[data.community_id] || 0) + 1;
        }
      });
      setMemberCounts(counts);
    }, (error) => {
      console.warn("Access restricted:", error.message);
    });

    return () => unsubscribe();
  }, []);

  const filteredCommunities = communities.filter((community) => {
    const matchesLocation = selectedLocation === "All" || community.location_area === selectedLocation;
    const matchesSearch = (community.name || "").toLowerCase().includes(search.toLowerCase()) || 
                          (community.description || "").toLowerCase().includes(search.toLowerCase());
    return matchesLocation && matchesSearch;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <MatrixBackground />
      
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Browse Communities</Text>
          <Text style={styles.headerSubtitle}>Find a buying group near you</Text>
        </View>
        <TouchableOpacity style={styles.createButton} activeOpacity={0.8} onPress={() => router.push('/community/create')}>
          <Text style={styles.createButtonText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      {/* Search and Filters Section */}
      <View style={styles.filterSection}>
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search communities..."
            placeholderTextColor="#6b7280"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Text style={styles.clearIcon}>✖️</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Horizontal Scrollable Location Filters */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.locationList}
          contentContainerStyle={styles.locationListContent}
        >
          {LOCATIONS.map((loc) => {
            const isSelected = selectedLocation === loc;
            return (
              <TouchableOpacity
                key={loc}
                style={[styles.locationTab, isSelected && styles.locationTabSelected]}
                onPress={() => setSelectedLocation(loc)}
                activeOpacity={0.7}
              >
                <Text style={[styles.locationText, isSelected && styles.locationTextSelected]}>
                  {loc}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Communities Vertical List */}
      <ScrollView 
        style={styles.scrollList}
        contentContainerStyle={styles.scrollListContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color="#7c3aed" />
          </View>
        ) : filteredCommunities.length > 0 ? (
          filteredCommunities.map((community) => (
            <LiquidCard intensity={40} key={community.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.communityIconContainer}>
                  <Text style={styles.communityIconText}>👥</Text>
                </View>
                <View style={styles.locationBadge}>
                  <Text style={styles.locationBadgeText}>📍 {community.location_area}</Text>
                </View>
              </View>

              <Text style={styles.cardTitle}>{community.name}</Text>
              <Text style={styles.cardDescription} numberOfLines={2}>
                {community.description}
              </Text>

              <View style={styles.cardFooter}>
                <Text style={styles.memberCountText}>
                  👥 {memberCounts[community.id] || 0} members
                </Text>
                <TouchableOpacity 
                  style={styles.viewButton}
                  onPress={() => router.push(`/community/${community.id}`)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.viewButtonText}>View Group</Text>
                </TouchableOpacity>
              </View>
            </LiquidCard>
          ))
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyTitle}>No Communities Found</Text>
            <Text style={styles.emptySubtitle}>Try adjusting your search or location filter.</Text>
          </View>
        )}
      </ScrollView>
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
    fontSize: 24,
    fontWeight: '700',
    color: '#f0f0ff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
  },
  createButton: {
    backgroundColor: '#7c3aed',
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  createButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  filterSection: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 20, 30, 0.6)',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    height: 48,
    marginBottom: 12,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#f0f0ff',
  },
  clearIcon: {
    fontSize: 12,
    color: '#9ca3af',
    marginLeft: 8,
  },
  locationList: {
    flexDirection: 'row',
  },
  locationListContent: {
    gap: 8,
    paddingRight: 20,
  },
  locationTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(20, 20, 30, 0.6)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  locationTabSelected: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  locationText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
  },
  locationTextSelected: {
    color: '#f0f0ff',
  },
  scrollList: {
    flex: 1,
  },
  scrollListContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
    flexGrow: 1,
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
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  viewButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f0f0ff',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
  },
});
