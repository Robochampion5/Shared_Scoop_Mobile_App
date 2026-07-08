// Author: Adarsh Singh | Roll No: IC2025006
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Slider from '@react-native-community/slider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  doc,
  onSnapshot,
  query,
  collection,
  where,
  limit,
  orderBy,
  addDoc,
  updateDoc,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '../../lib/firebase';
import { Community, Order } from '../../lib/types';
import MatrixBackground from '../../components/MatrixBackground';

// ─── Design System Constants ──────────────────────────────────────────────────
const GAP = 16;
const PADDING = 20;

// ─── Local Types ──────────────────────────────────────────────────────────────
interface MemberRecord {
  id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected';
  full_name?: string;
  email?: string;
}

interface Pledge {
  id: string;
  user_id: string;
  kg_committed: number;
  full_name?: string;
}

type ActiveTab = 'pool' | 'members' | 'chat';

// ─── GlassPanel Component ─────────────────────────────────────────────────────
function GlassPanel({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[styles.glassPanelOuter, style]}>
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.glassBorder} />
      <View style={styles.glassPanelInner}>{children}</View>
    </View>
  );
}

// ─── Tab Bar Component ────────────────────────────────────────────────────────
function TabBar({
  tabs,
  activeTab,
  onPress,
}: {
  tabs: { key: ActiveTab; label: string }[];
  activeTab: ActiveTab;
  onPress: (key: ActiveTab) => void;
}) {
  return (
    <View style={styles.tabBarContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBarContent}
      >
        {tabs.map((t) => {
          const isActive = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.tabItem}
              onPress={() => onPress(t.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabItemText, isActive && styles.tabItemTextActive]}>
                {t.label}
              </Text>
              {isActive && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CommunityHubScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const communityId = typeof id === 'string' ? id : '';

  // ── State
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [membership, setMembership] = useState<MemberRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [allMembers, setAllMembers] = useState<MemberRecord[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('pool');
  const [pledgeKg, setPledgeKg] = useState('');
  const [pledgeLoading, setPledgeLoading] = useState(false);

  // Admin lock-pool
  const [isLocking, setIsLocking] = useState(false);
  // localMoq: decoupled slider UI state — never triggers Firestore directly
  const [localMoq, setLocalMoq] = useState(15);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);

  // ── Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setCurrentUser(u));
    return () => unsub();
  }, []);

  // ── Community listener
  useEffect(() => {
    if (!communityId) return;
    const unsub = onSnapshot(
      doc(db, 'communities', communityId),
      (snap) => {
        if (snap.exists()) setCommunity({ id: snap.id, ...snap.data() } as Community);
        setLoading(false);
      },
      (err) => { console.warn('Community restricted:', err.message); setLoading(false); }
    );
    return () => unsub();
  }, [communityId]);

  // ── Active order listener (Optimized)
  // RATIONALE: where('status', '==', 'pooling') + orderBy('created_at') requires a
  // composite index and collapses the query result to empty the moment the admin
  // locks the pool. We fetch the single most-recent order universally — the
  // status field is available on the document for conditional rendering.
  useEffect(() => {
    if (!communityId) return;
    const q = query(
      collection(db, 'orders'),
      where('community_id', '==', communityId),
      orderBy('created_at', 'desc'),
      limit(1)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!snap.empty) {
          const orderData = { id: snap.docs[0].id, ...snap.docs[0].data() } as Order;
          setOrder(orderData);
          setLocalMoq(Number(orderData.total_kg_required) || 15);
        } else {
          setOrder(null);
        }
      },
      (err) => console.warn('Order restricted:', err.message)
    );
    return () => unsub();
  }, [communityId]);

  // ── Membership listener (current user only)
  useEffect(() => {
    if (!communityId || !currentUser?.uid) return;
    const q = query(
      collection(db, 'community_members'),
      where('community_id', '==', communityId),
      where('user_id', '==', currentUser.uid),
      limit(1)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!snap.empty) setMembership({ id: snap.docs[0].id, ...snap.docs[0].data() } as MemberRecord);
        else setMembership(null);
      },
      (err) => console.warn('Membership restricted:', err.message)
    );
    return () => unsub();
  }, [communityId, currentUser?.uid]);

  // ── RBAC: Admin flag — computed from community + currentUser uid
  // Supports both admin_uid and admin_id field names for compatibility
  const isAdmin = !!(
    currentUser &&
    community &&
    (community.admin_uid === currentUser.uid || community.admin_id === currentUser.uid)
  );

  // ── Admin: all-members listener (only fires when isAdmin is true)
  useEffect(() => {
    if (!communityId || !isAdmin) return;
    const q = query(collection(db, 'community_members'), where('community_id', '==', communityId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const recs: MemberRecord[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            user_id: data.user_id,
            status: data.status,
            full_name: data.full_name || 'Unknown User',
            email: data.email || 'No email attached',
          };
        });
        setAllMembers(recs);
      },
      (err) => console.warn('Members restricted:', err.message)
    );
    return () => unsub();
  }, [communityId, isAdmin]);

  // ── Admin: pledges listener (only fires when order exists and isAdmin is true)
  useEffect(() => {
    if (!order?.id || !isAdmin) return;
    const q = query(collection(db, 'contributions'), where('order_id', '==', order.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Pledge[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            user_id: data.user_id,
            kg_committed: data.kg_committed,
            full_name: data.full_name || 'Unknown User',
          };
        });
        setPledges(items);
      },
      (err) => console.warn('Pledges restricted:', err.message)
    );
    return () => unsub();
  }, [order?.id, isAdmin]);

  // ── Chat listener (fires for admin OR approved members only)
  useEffect(() => {
    if (!communityId) return;
    const canChat = isAdmin || membership?.status === 'approved';
    if (!canChat) return;
    const q = query(
      collection(db, 'messages'),
      where('community_id', '==', communityId),
      orderBy('created_at', 'asc'),
      limit(60)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setChatMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);
      },
      (err) => console.warn('Chat restricted:', err.message)
    );
    return () => unsub();
  }, [communityId, isAdmin, membership?.status]);

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleRequestJoin = async () => {
    if (!currentUser?.uid) return;
    try {
      await addDoc(collection(db, 'community_members'), {
        community_id: communityId,
        user_id: currentUser.uid,
        status: 'pending',
        full_name: currentUser.displayName || 'Unknown User',
        email: currentUser.email || '',
        created_at: serverTimestamp(),
      });
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handlePledge = async () => {
    const kg = parseFloat(pledgeKg);
    if (!kg || kg <= 0) { Alert.alert('Validation', 'Enter a valid kg amount.'); return; }
    if (!order?.id || !currentUser?.uid) return;
    setPledgeLoading(true);
    try {
      const existing = await getDocs(query(
        collection(db, 'contributions'),
        where('order_id', '==', order.id),
        where('user_id', '==', currentUser.uid),
        limit(1)
      ));
      if (!existing.empty) {
        await updateDoc(doc(db, 'contributions', existing.docs[0].id), { kg_committed: kg });
      } else {
        await addDoc(collection(db, 'contributions'), {
          order_id: order.id,
          community_id: communityId,
          user_id: currentUser.uid,
          full_name: currentUser.displayName || 'Unknown User',
          kg_committed: kg,
          amount_paid: 0,
          status: 'pending',
          created_at: serverTimestamp(),
        });
      }
      const allSnap = await getDocs(query(collection(db, 'contributions'), where('order_id', '==', order.id)));
      let total = 0;
      allSnap.forEach((d) => { total += d.data().kg_committed || 0; });
      await updateDoc(doc(db, 'orders', order.id), { total_kg_committed: total });
      setPledgeKg('');
      Alert.alert('Pledged!', `You have committed ${kg}kg to this pool.`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setPledgeLoading(false);
  };

  const handleApprove = async (membershipId: string) => {
    try { await updateDoc(doc(db, 'community_members', membershipId), { status: 'approved' }); }
    catch (e: any) { Alert.alert('Error', e.message); }
  };

  const handleDeny = async (membershipId: string) => {
    try { await updateDoc(doc(db, 'community_members', membershipId), { status: 'rejected' }); }
    catch (e: any) { Alert.alert('Error', e.message); }
  };

  const handleSendMessage = async () => {
    const text = chatInput.trim();
    if (!text || !currentUser?.uid) return;
    setChatSending(true);
    try {
      await addDoc(collection(db, 'messages'), {
        community_id: communityId,
        user_id: currentUser.uid,
        sender_name: currentUser.displayName || 'Member',
        text,
        created_at: serverTimestamp(),
      });
      setChatInput('');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setChatSending(false);
  };

  // ─── Lock Pool ─────────────────────────────────────────────────────────────
  // DEFENSIVE: reads raw text first — Vercel 500 errors return HTML, not JSON.
  // Calling .json() directly on an HTML body produces: SyntaxError: Unexpected character '<'
  // On 200 OK → transitions order status 'pooling' → 'locked' in Firestore.
  const handleLockPool = async () => {
    if (!order?.id || !currentUser || isLocking) return;
    Alert.alert(
      'Lock Pool?',
      'This will freeze the pool and trigger Razorpay payment links for all pledgers. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Lock & Trigger',
          style: 'destructive',
          onPress: async () => {
            setIsLocking(true);
            try {
              const idToken = await currentUser.getIdToken(true);
              const response = await fetch(
                'https://shared-scoop-backend-czvvcscei-adarshsingh120308-2868s-projects.vercel.app/api/trigger-razorpay',
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                  },
                  body: JSON.stringify({ poolId: order.id }),
                }
              );

              // Read raw text FIRST — never blindly call .json() on a Vercel error page
              const rawText = await response.text();
              console.log('[LockPool] HTTP', response.status, '| RAW:', rawText.slice(0, 300));

              if (rawText.trimStart().startsWith('<')) {
                throw new Error(
                  `Vercel returned HTML (HTTP ${response.status}). ` +
                  `Route /api/trigger-razorpay may not exist.\n${rawText.slice(0, 200)}`
                );
              }

              let data: any;
              try { data = JSON.parse(rawText); }
              catch { throw new Error(`Non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 200)}`); }

              if (!response.ok) {
                throw new Error(data?.error || `Vercel rejected with HTTP ${response.status}`);
              }

              // Trigger succeeded — lock the order in Firestore
              await updateDoc(doc(db, 'orders', order.id), { status: 'locked' });
              Alert.alert('✅ Pool Locked', 'Razorpay payment links dispatched. The pool is now closed.');
            } catch (e: any) {
              console.error('[LockPool]', e.message);
              Alert.alert('Lock Failed', e.message);
            } finally {
              setIsLocking(false);
            }
          },
        },
      ]
    );
  };

  // ─── Derived Values ────────────────────────────────────────────────────────
  const totalCommitted = order?.total_kg_committed || 0;
  const totalRequired = order?.total_kg_required || 15;
  const progressPercent = Math.min((totalCommitted / totalRequired) * 100, 100);
  const pendingMembers = allMembers.filter((m) => m.status === 'pending');
  const approvedMembers = allMembers.filter((m) => m.status === 'approved');

  // ─── Shared Render Helpers ─────────────────────────────────────────────────
  const renderNavHeader = (title: string) => (
    <View style={styles.navHeader}>
      <TouchableOpacity
        style={styles.navBackBtn}
        onPress={() => router.back()}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.navBackBtnText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.navTitle} numberOfLines={1}>{title}</Text>
      {/* Spacer keeps title centered */}
      <View style={styles.navSpacer} />
    </View>
  );

  const renderInfoCard = () => (
    <GlassPanel style={{ marginHorizontal: GAP }}>
      <View style={styles.infoRow}>
        <View style={styles.communityIcon}>
          <Text style={{ fontSize: 26 }}>👥</Text>
        </View>
        <View style={styles.locationBadge}>
          <Text style={styles.locationBadgeText}>📍 {community?.location_area}</Text>
        </View>
      </View>
      <Text style={styles.communityName}>{community?.name}</Text>
      {!!community?.description && (
        <Text style={styles.communityDesc}>{community.description}</Text>
      )}
      {isAdmin && (
        <View style={styles.adminBadge}>
          <Text style={styles.adminBadgeText}>⚡ Community Admin</Text>
        </View>
      )}
    </GlassPanel>
  );

  const renderProgressBar = () => (
    <View>
      <View style={styles.progressRow}>
        <Text style={styles.progressLabel}>Pool Progress</Text>
        <Text style={styles.progressValue}>{totalCommitted}kg / {totalRequired}kg MOQ</Text>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${progressPercent}%` as any,
              backgroundColor: progressPercent >= 100 ? '#34d399' : '#84cc16',
            },
          ]}
        />
      </View>
      <Text style={styles.progressPercent}>{Math.round(progressPercent)}% to MOQ</Text>
    </View>
  );

  const renderChatPanel = () => (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        ref={chatScrollRef}
        style={styles.chatScroll}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator={false}
      >
        {chatMessages.length === 0 ? (
          <View style={styles.chatEmpty}>
            <Text style={styles.emptyStateText}>No messages yet. Say hello! 👋</Text>
          </View>
        ) : (
          chatMessages.map((msg) => {
            const isMe = msg.user_id === currentUser?.uid;
            return (
              <View
                key={msg.id}
                style={[styles.msgWrapper, isMe ? styles.msgWrapperMe : styles.msgWrapperThem]}
              >
                {!isMe && <Text style={styles.msgSenderName}>{msg.sender_name}</Text>}
                <View style={[styles.msgBubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                  <Text style={styles.msgText}>{msg.text}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Fixed Chat Input Bar */}
      <View style={styles.chatInputContainer}>
        <TextInput
          style={styles.chatInput}
          placeholder="Message the community..."
          placeholderTextColor="#6b7280"
          value={chatInput}
          onChangeText={setChatInput}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!chatInput.trim() || chatSending) && { opacity: 0.5 }]}
          onPress={handleSendMessage}
          disabled={!chatInput.trim() || chatSending}
          activeOpacity={0.8}
        >
          {chatSending
            ? <ActivityIndicator color="#ffffff" size="small" />
            : <Text style={styles.sendBtnText}>➤</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );

  // ─── Guard: Loading ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={styles.loadingText}>Loading Hub...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Guard: Not Found ──────────────────────────────────────────────────────
  if (!community) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Community not found.</Text>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()}>
            <Text style={styles.ghostBtnText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── RBAC Branch: ADMIN VIEW ───────────────────────────────────────────────
  // Admin gets 3 tabs and bypasses all membership checks entirely.
  if (isAdmin) {
    const ADMIN_TABS: { key: ActiveTab; label: string }[] = [
      { key: 'pool', label: '🎯 Pool Control' },
      { key: 'members', label: '👥 Members' },
      { key: 'chat', label: '💬 Chat' },
    ];

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />

        {renderNavHeader('Admin Hub')}

        <View style={styles.infoCardWrapper}>{renderInfoCard()}</View>

        <TabBar tabs={ADMIN_TABS} activeTab={activeTab} onPress={setActiveTab} />

        {/* Tab Content */}
        {activeTab === 'chat' ? renderChatPanel() : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Pool Control Tab */}
            {activeTab === 'pool' && (
              <>
                {order ? (
                  <>
                    {/* ── Telemetry Control Panel ────────────────────────── */}
                    <GlassPanel>
                      <Text style={styles.sectionTitle}>🎯 Pool Status</Text>

                      {/* Progress labels */}
                      <View style={styles.progressRow}>
                        <Text style={styles.progressLabel}>Pledged</Text>
                        <Text style={styles.progressValue}>
                          {totalCommitted}kg / {localMoq}kg MOQ
                        </Text>
                      </View>

                      {/* Progress bar — track + fill */}
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              width: `${Math.min((totalCommitted / localMoq) * 100, 100)}%` as any,
                              backgroundColor:
                                Math.min((totalCommitted / localMoq) * 100, 100) >= 100
                                  ? '#34d399'
                                  : '#7c3aed',
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.progressPercent}>
                        {Math.round(Math.min((totalCommitted / localMoq) * 100, 100))}% to MOQ
                      </Text>

                      {/* ── Integrated MOQ Slider ──────────────────────── */}
                      <View style={styles.moqSliderContainer}>
                        <View style={styles.moqSliderHeader}>
                          <Text style={styles.moqSliderLabel}>Adjust MOQ Target</Text>
                          <View style={styles.moqValueBadge}>
                            <Text style={styles.moqValueText}>{localMoq} kg</Text>
                          </View>
                        </View>
                        <Slider
                          style={styles.moqSlider}
                          minimumValue={15}
                          maximumValue={30}
                          step={1}
                          // Bind to local state only — zero Firestore I/O on drag
                          value={localMoq}
                          // Instant visual feedback: update local state each frame
                          onValueChange={(val) => setLocalMoq(Math.round(val))}
                          // Firestore write fires ONCE when finger lifts
                          onSlidingComplete={async (val) => {
                            const clamped = Math.max(15, Math.round(val));
                            setLocalMoq(clamped);
                            if (order?.id) {
                              try {
                                await updateDoc(doc(db, 'orders', order.id), {
                                  total_kg_required: clamped,
                                });
                                console.log('[MOQ] Saved:', clamped, 'kg');
                              } catch (e: any) {
                                console.warn('[MOQ] Save failed:', e.message);
                              }
                            }
                          }}
                          minimumTrackTintColor="#7c3aed"
                          maximumTrackTintColor="rgba(255,255,255,0.1)"
                          thumbTintColor="#34d399"
                        />
                        <View style={styles.moqSliderTicks}>
                          <Text style={styles.moqTickLabel}>15 kg</Text>
                          <Text style={styles.moqTickLabel}>30 kg</Text>
                        </View>
                      </View>
                    </GlassPanel>

                    {/* ── Pledge Ledger ──────────────────────────────────── */}
                    <GlassPanel>
                      <Text style={styles.sectionTitle}>📋 Pledge Ledger ({pledges.length})</Text>
                      {pledges.length === 0 ? (
                        <Text style={styles.emptyStateText}>No pledges submitted yet.</Text>
                      ) : (
                        pledges.map((p) => (
                          <View key={p.id} style={styles.pledgeRow}>
                            <View style={styles.avatarCircle}>
                              <Text style={styles.avatarText}>{(p.full_name?.[0] ?? '?').toUpperCase()}</Text>
                            </View>
                            <Text style={styles.pledgeName}>{p.full_name}</Text>
                            <View style={styles.kgBadge}>
                              <Text style={styles.kgBadgeText}>{p.kg_committed} kg</Text>
                            </View>
                          </View>
                        ))
                      )}
                    </GlassPanel>

                    <TouchableOpacity
                      style={[
                        styles.lockPoolBtn,
                        (isLocking || (order && order.status === 'locked')) && { opacity: 0.5 },
                      ]}
                      onPress={handleLockPool}
                      disabled={isLocking || (order && order.status === 'locked')}
                      activeOpacity={0.8}
                    >
                      {isLocking ? (
                        <ActivityIndicator color="#0f0f1a" size="small" />
                      ) : (
                        <Text style={styles.lockPoolBtnText}>
                          {order?.status === 'locked' ? '🔒 Pool Locked' : '🔒 Lock Pool & Trigger Payments'}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.adminManageBtn}
                      onPress={() => router.push(`/community/edit/${communityId}` as any)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.adminManageBtnText}>⚙️ Manage Order & Pool Settings</Text>
                    </TouchableOpacity>

                    {/* QR Scanner — only actionable after pool is locked */}
                    <TouchableOpacity
                      style={[
                        styles.scannerBtn,
                        order?.status !== 'locked' && { opacity: 0.4 },
                      ]}
                      onPress={() => router.push(`/community/scan/${order?.id ?? communityId}` as any)}
                      disabled={order?.status !== 'locked'}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.scannerBtnText}>
                        {order?.status === 'locked'
                          ? '📷 Open QR Fulfillment Scanner'
                          : '📷 Scanner (Lock Pool First)'}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <GlassPanel>
                    <Text style={styles.sectionTitle}>No Active Pool</Text>
                    <Text style={styles.communityDesc}>
                      No pooling order is active. Create one from Order Management.
                    </Text>
                    <TouchableOpacity
                      style={styles.primaryBtn}
                      onPress={() => router.push(`/community/edit/${communityId}` as any)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.primaryBtnText}>Open Order Management</Text>
                    </TouchableOpacity>
                  </GlassPanel>
                )}
              </>
            )}

            {/* Members Tab */}
            {activeTab === 'members' && (
              <>
                <GlassPanel>
                  <Text style={styles.sectionTitle}>🕐 Pending Requests ({pendingMembers.length})</Text>
                  {pendingMembers.length === 0 ? (
                    <Text style={styles.emptyStateText}>No pending requests.</Text>
                  ) : (
                    pendingMembers.map((m) => (
                      <View key={m.id} style={styles.memberRow}>
                        <View style={styles.avatarCircle}>
                          <Text style={styles.avatarText}>{(m.full_name?.[0] ?? '?').toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={styles.memberName}>{m.full_name}</Text>
                          <Text style={styles.memberEmail}>{m.email}</Text>
                        </View>
                        <View style={styles.approvalRow}>
                          <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(m.id)} activeOpacity={0.8}>
                            <Text style={styles.approveBtnText}>✓</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.denyBtn} onPress={() => handleDeny(m.id)} activeOpacity={0.8}>
                            <Text style={styles.denyBtnText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}
                </GlassPanel>

                <GlassPanel>
                  <Text style={styles.sectionTitle}>✅ Approved Members ({approvedMembers.length})</Text>
                  {approvedMembers.length === 0 ? (
                    <Text style={styles.emptyStateText}>No approved members yet.</Text>
                  ) : (
                    approvedMembers.map((m) => (
                      <View key={m.id} style={styles.memberRow}>
                        <View style={[styles.avatarCircle, { backgroundColor: 'rgba(52,211,153,0.15)' }]}>
                          <Text style={styles.avatarText}>{(m.full_name?.[0] ?? '?').toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={styles.memberName}>{m.full_name}</Text>
                          <Text style={styles.memberEmail}>{m.email}</Text>
                        </View>
                        <View style={styles.approvedTag}>
                          <Text style={styles.approvedTagText}>Approved</Text>
                        </View>
                      </View>
                    ))
                  )}
                </GlassPanel>
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  // ─── RBAC Branch: STANDARD USER — UNJOINED ────────────────────────────────
  if (!membership) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />
        {renderNavHeader('Community Hub')}
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {renderInfoCard()}
          {order && (
            <GlassPanel>
              <Text style={styles.sectionTitle}>Active Pool</Text>
              {renderProgressBar()}
            </GlassPanel>
          )}
          <GlassPanel>
            <Text style={styles.sectionTitle}>Join This Community</Text>
            <Text style={styles.communityDesc}>
              Submit a join request. The admin will review and approve your membership.
            </Text>
            <TouchableOpacity style={styles.joinBtn} onPress={handleRequestJoin} activeOpacity={0.8}>
              <Text style={styles.joinBtnText}>Request to Join</Text>
            </TouchableOpacity>
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── RBAC Branch: STANDARD USER — PENDING ────────────────────────────────
  if (membership.status === 'pending') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />
        {renderNavHeader('Community Hub')}
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {renderInfoCard()}
          <GlassPanel>
            <View style={styles.stateContainer}>
              <Text style={styles.stateIcon}>⏳</Text>
              <Text style={styles.stateTitle}>Awaiting Admin Approval</Text>
              <Text style={styles.stateDesc}>Your join request is under review. Check back soon.</Text>
            </View>
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── RBAC Branch: STANDARD USER — REJECTED ───────────────────────────────
  if (membership.status === 'rejected') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />
        {renderNavHeader('Community Hub')}
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {renderInfoCard()}
          <GlassPanel>
            <View style={styles.stateContainer}>
              <Text style={styles.stateIcon}>❌</Text>
              <Text style={[styles.stateTitle, { color: '#ef4444' }]}>Request Denied</Text>
              <Text style={styles.stateDesc}>Your membership request was not approved by the admin.</Text>
            </View>
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── RBAC Branch: STANDARD USER — APPROVED (2-tab layout) ────────────────
  const USER_TABS: { key: ActiveTab; label: string }[] = [
    { key: 'pool', label: '🥩 The Pool' },
    { key: 'chat', label: '💬 Chat' },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <MatrixBackground />
      {renderNavHeader('Community Hub')}

      <View style={styles.infoCardWrapper}>{renderInfoCard()}</View>

      <TabBar tabs={USER_TABS} activeTab={activeTab} onPress={setActiveTab} />

      {activeTab === 'chat' ? renderChatPanel() : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {order ? (
            <>
              <GlassPanel>
                <Text style={styles.sectionTitle}>
                  🎯 {order.status === 'locked' ? 'Locked Pool' : 'Active Pool'}
                </Text>
                {renderProgressBar()}
              </GlassPanel>

              {order.status === 'locked' ? (
                <GlassPanel>
                  <Text style={styles.sectionTitle}>🔒 Pool Closed</Text>
                  <Text style={styles.communityDesc}>
                    This pool has been locked by the admin to finalize wholesale requirements.
                    Check your SMS for the Razorpay checkout link.
                  </Text>
                </GlassPanel>
              ) : (
                <GlassPanel>
                  <Text style={styles.sectionTitle}>Pledge Protein</Text>
                  <Text style={styles.communityDesc}>Enter how many kg you want to commit to this group buy.</Text>
                  <View style={styles.pledgeInputRow}>
                    <TextInput
                      style={styles.pledgeInput}
                      placeholder="e.g. 2"
                      placeholderTextColor="#6b7280"
                      keyboardType="number-pad"
                      value={pledgeKg}
                      onChangeText={setPledgeKg}
                    />
                    <Text style={styles.pledgeUnit}>kg</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.pledgeBtn, pledgeLoading && { opacity: 0.6 }]}
                    onPress={handlePledge}
                    disabled={pledgeLoading}
                    activeOpacity={0.8}
                  >
                    {pledgeLoading
                      ? <ActivityIndicator color="#0f0f1a" />
                      : <Text style={styles.pledgeBtnText}>Pledge Protein</Text>}
                  </TouchableOpacity>
                </GlassPanel>
              )}
            </>
          ) : (
            <GlassPanel>
              <Text style={styles.sectionTitle}>No Active Pool</Text>
              <Text style={styles.communityDesc}>The admin hasn't opened a pooling order yet. Check back soon.</Text>
            </GlassPanel>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Consolidated Style Engine ────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Foundation
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: PADDING,
  },
  loadingText: {
    marginTop: 12,
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    color: '#f0f0ff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },

  // Glass Panel
  glassPanelOuter: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: GAP,
  },
  glassBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  glassPanelInner: {
    padding: 18,
  },

  // Navigation Header — fixed 60px height
  navHeader: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: PADDING,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(15,15,26,0.9)',
  },
  navBackBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  navBackBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a78bfa',
  },
  navTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: '#f0f0ff',
    zIndex: -1,
  },
  navSpacer: {
    minWidth: 44,
  },

  // Layout Helpers
  infoCardWrapper: {
    paddingTop: GAP,
    paddingBottom: 4,
  },
  scrollContent: {
    paddingHorizontal: GAP,
    paddingTop: GAP,
    paddingBottom: 48,
  },

  // Info Card internals
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  communityIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(132,204,22,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
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
    marginBottom: 6,
  },
  communityDesc: {
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
    marginBottom: 12,
  },
  adminBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(124,58,237,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.3)',
    marginTop: 4,
  },
  adminBadgeText: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '700',
  },

  // Progress Bar
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '600',
  },
  progressValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f0f0ff',
  },
  progressTrack: {
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
  },
  progressPercent: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'right',
    marginBottom: 4,
  },

  // MOQ Slider — integrated into telemetry control panel
  moqSliderContainer: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  moqSliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  moqSliderLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
  },
  moqValueBadge: {
    backgroundColor: 'rgba(124,58,237,0.2)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  moqValueText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#a78bfa',
  },
  moqSlider: {
    width: '100%',
    height: 44,
  },
  moqSliderTicks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  moqTickLabel: {
    fontSize: 10,
    color: '#6b7280',
    fontWeight: '500',
  },

  // Section Title
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f0f0ff',
    marginBottom: 16,
  },

  // Segmented Tab Bar — fixed 56px height
  tabBarContainer: {
    height: 56,
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 15, 26, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  tabBarContent: {
    flexDirection: 'row',
    paddingHorizontal: GAP,
  },
  tabItem: {
    paddingHorizontal: PADDING,
    paddingTop: 14,
    paddingBottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  tabItemText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: 4,
  },
  tabItemTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  tabUnderline: {
    height: 3,
    width: '100%',
    backgroundColor: '#7c3aed',
    borderRadius: 2,
    marginTop: 4,
  },

  // Pledge Ledger Row
  pledgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(124,58,237,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#a78bfa',
    fontWeight: '700',
    fontSize: 14,
  },
  pledgeName: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#f0f0ff',
  },
  kgBadge: {
    backgroundColor: 'rgba(52,211,153,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.2)',
  },
  kgBadgeText: {
    color: '#34d399',
    fontWeight: '700',
    fontSize: 13,
  },

  // Members
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f0f0ff',
  },
  memberEmail: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  approvalRow: {
    flexDirection: 'row',
    gap: 8,
  },
  approveBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(52,211,153,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtnText: {
    color: '#34d399',
    fontWeight: '700',
    fontSize: 16,
  },
  denyBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  denyBtnText: {
    color: '#ef4444',
    fontWeight: '700',
    fontSize: 16,
  },
  approvedTag: {
    backgroundColor: 'rgba(52,211,153,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  approvedTagText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },

  // Buttons
  primaryBtn: {
    backgroundColor: '#7c3aed',
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  joinBtn: {
    backgroundColor: '#34d399',
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  joinBtnText: {
    color: '#0f0f1a',
    fontSize: 15,
    fontWeight: '700',
  },
  ghostBtn: {
    paddingHorizontal: GAP,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
  },
  ghostBtnText: {
    color: '#a78bfa',
    fontWeight: '600',
  },
  adminManageBtn: {
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.3)',
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: GAP,
  },
  adminManageBtnText: {
    color: '#a78bfa',
    fontSize: 14,
    fontWeight: '700',
  },
  // Lock Pool — destructive CTA, red-amber gradient feel
  lockPoolBtn: {
    backgroundColor: '#ef4444',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  lockPoolBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // QR Scanner button — green accent (fulfillment action, post-lock)
  scannerBtn: {
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  scannerBtnText: {
    color: '#34d399',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Pledge Input
  pledgeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,30,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    marginBottom: 12,
    paddingHorizontal: GAP,
    height: 48,
  },
  pledgeInput: {
    flex: 1,
    color: '#f0f0ff',
    fontSize: 16,
    fontWeight: '600',
  },
  pledgeUnit: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  pledgeBtn: {
    backgroundColor: '#34d399',
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pledgeBtnText: {
    color: '#0f0f1a',
    fontSize: 15,
    fontWeight: '700',
  },

  // State screens
  stateContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  stateIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f0f0ff',
    marginBottom: 8,
    textAlign: 'center',
  },
  stateDesc: {
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: 8,
  },

  // Chat — CRITICAL FIX
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: GAP,
    paddingTop: GAP,
    paddingBottom: 20,
  },
  chatEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
  },
  msgWrapper: {
    marginBottom: GAP,
  },
  msgWrapperMe: {
    alignItems: 'flex-end',
  },
  msgWrapperThem: {
    alignItems: 'flex-start',
  },
  msgSenderName: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 4,
    marginLeft: 4,
  },
  msgBubble: {
    maxWidth: '85%',
    paddingHorizontal: GAP,
    paddingVertical: 12,
    borderRadius: 20,
  },
  bubbleMe: {
    backgroundColor: '#7c3aed',
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: 'rgba(20, 20, 30, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderBottomLeftRadius: 4,
  },
  msgText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
  },
  // Fixed input container, pinned to bottom
  chatInputContainer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f1a',
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  chatInput: {
    flex: 1,
    minHeight: 52,
    borderRadius: 26,
    paddingHorizontal: PADDING,
    paddingTop: Platform.OS === 'ios' ? 14 : 10,
    paddingBottom: Platform.OS === 'ios' ? 14 : 10,
    backgroundColor: 'rgba(20, 20, 30, 0.9)',
    color: '#ffffff',
    fontSize: 16,
    maxHeight: 120,
  },
  sendBtn: {
    marginLeft: 12,
    height: 52,
    width: 52,
    borderRadius: 26,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
