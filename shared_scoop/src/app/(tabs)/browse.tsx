import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet, SafeAreaView, StatusBar, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Community } from '@/lib/types';

const LOCATIONS = ["All", "Koramangala", "Whitefield", "Indiranagar", "HSR Layout", "Marathahalli", "Jayanagar"];

export default function BrowseCommunitiesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("All");

  // Real-time state
  const [communities, setCommunities] = useState<Community[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Subscribe to real-time communities
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
      console.error("Error listening to communities:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to real-time approved membership counts
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
      console.error("Error listening to memberships:", error);
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
      <StatusBar barStyle="dark-content" />
      
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
            placeholderTextColor="#9ca3af"
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
            <ActivityIndicator size="large" color="#84cc16" />
          </View>
        ) : filteredCommunities.length > 0 ? (
          filteredCommunities.map((community) => (
            <View key={community.id} style={styles.card}>
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
            </View>
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
    backgroundColor: '#f9fafb', // Light grey background
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
    color: '#111827', // Dark slate/grey
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280', // Slate grey
    marginTop: 2,
  },
  createButton: {
    backgroundColor: '#84cc16', // Scoop brand lime green
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  createButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  filterSection: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
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
    color: '#111827',
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
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  locationTabSelected: {
    backgroundColor: '#84cc16',
    borderColor: '#84cc16',
  },
  locationText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#4b5563',
  },
  locationTextSelected: {
    color: '#ffffff',
  },
  scrollList: {
    flex: 1,
  },
  scrollListContent: {
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
    backgroundColor: 'rgba(132, 204, 22, 0.1)', // Translucent lime
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityIconText: {
    fontSize: 20,
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
    paddingVertical: 40,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
  },
});
