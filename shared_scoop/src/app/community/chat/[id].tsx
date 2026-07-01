// Author: Adarsh Singh | Roll No: IC2025006
//
// ⚠️  FIRESTORE COMPOSITE INDEX REQUIRED
// The query in this file chains:
//   where('community_id', '==', id) + orderBy('created_at', 'asc')
// Firestore requires a composite index for this combination.
// If you see "The query requires an index" in the console, click the link
// printed by Firestore to create the index in one click.
// Collection: messages  |  Fields: community_id ASC, created_at ASC
//
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '../../../lib/firebase';
import MatrixBackground from '../../../components/MatrixBackground';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  text: string;
  user_id: string;
  // sender_name is DENORMALIZED onto the document at write time.
  // We never call getDocs inside a listener loop — that is an N+1 read violation.
  sender_name: string;
  created_at: any;
}

// ─── GlassPanel ─────────────────────────────────────────────────────────────────
function GlassPanel({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.glassPanelOuter}>
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.glassBorder} />
      <View style={styles.glassPanelInner}>{children}</View>
    </View>
  );
}

// ─── MessageBubble — React.memo prevents re-render of existing messages ──────────
// When a new message is appended to the list, only the new item renders;
// all prior bubbles are skipped by the memo equality check.
const MessageBubble = React.memo(function MessageBubble({
  message,
  isMe,
}: {
  message: Message;
  isMe: boolean;
}) {
  return (
    <View style={[styles.msgWrapper, isMe ? styles.msgWrapperMe : styles.msgWrapperThem]}>
      {!isMe && <Text style={styles.senderName}>{message.sender_name}</Text>}
      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
        <Text style={styles.bubbleText}>{message.text}</Text>
      </View>
    </View>
  );
});

// ─── Screen ──────────────────────────────────────────────────────────────────────
export default function CommunityChatScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const communityId = typeof id === 'string' ? id : '';

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // RBAC gate — reads from the correct collection: community_members
  const [memberStatus, setMemberStatus] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const flatListRef = useRef<FlatList<Message>>(null);

  // ── Auth listener ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setCurrentUser(u));
    return () => unsub();
  }, []);

  // ── Membership gate (correct collection: community_members) ───────────────────
  useEffect(() => {
    if (!currentUser?.uid || !communityId) {
      setLoadingStatus(false);
      return;
    }
    setLoadingStatus(true);

    // ARCHITECTURAL NOTE: Collection is 'community_members', NOT 'memberships'
    const q = query(
      collection(db, 'community_members'),
      where('community_id', '==', communityId),
      where('user_id', '==', currentUser.uid),
      limit(1)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setMemberStatus(snap.empty ? null : snap.docs[0].data().status);
        setLoadingStatus(false);
      },
      (err) => {
        console.warn('Membership gate restricted:', err.message);
        setLoadingStatus(false);
      }
    );
    return () => unsub();
  }, [currentUser?.uid, communityId]);

  // ── Messages listener ─────────────────────────────────────────────────────────
  // ARCHITECTURAL INVARIANTS:
  // 1. Query targets the top-level 'messages' collection (not a subcollection).
  // 2. The compound query (community_id + created_at) REQUIRES a composite index.
  //    Firestore will print the one-click creation URL to the console if missing.
  // 3. sender_name is read directly from the document — NO getDocs inside the loop.
  // 4. Messages arrive in ASC order; ScrollView scrolls to bottom on update.
  useEffect(() => {
    if (!communityId) return;

    // Determine access: admin OR approved member
    // We allow the listener to run — Firestore rules enforce the access gate on the server.
    // The RBAC UI gate above controls what the user *sees*, not what Firestore *allows*.
    if (memberStatus !== 'approved') return;

    const q = query(
      collection(db, 'messages'),
      where('community_id', '==', communityId),
      orderBy('created_at', 'asc'),   // ← requires composite index (see file header)
      limit(80)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        // ✅ Synchronous map — no getDocs, no async calls inside listener
        const fetched: Message[] = snap.docs.map((d) => ({
          id: d.id,
          text: d.data().text ?? '',
          user_id: d.data().user_id ?? '',
          sender_name: d.data().sender_name ?? 'Member',  // denormalized field
          created_at: d.data().created_at,
        }));
        setMessages(fetched);
        // Scroll is handled by FlatList's onContentSizeChange — no setTimeout needed
      },
      (err) => {
        // If this error contains a URL, click it to create the composite index
        console.warn('Chat listener error (check for index URL):', err.message);
      }
    );
    return () => unsub();
  }, [communityId, memberStatus]);

  // ── Send handler ───────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !currentUser?.uid || !communityId) return;

    setInputText('');
    setIsSending(true);
    try {
      await addDoc(collection(db, 'messages'), {
        community_id: communityId,
        user_id: currentUser.uid,
        // Stamp sender_name at write time (denormalization — eliminates N+1 reads)
        sender_name: currentUser.displayName || 'Member',
        text,
        created_at: serverTimestamp(),
      });
    } catch (e: any) {
      console.error('Send failed:', e.message);
    } finally {
      setIsSending(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────────
  const renderNavHeader = () => (
    <View style={styles.navHeader}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => router.back()}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Community Chat</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  // ─── Loading state ─────────────────────────────────────────────────────────────
  if (loadingStatus) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />
        {renderNavHeader()}
        <View style={styles.centeredContainer}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={styles.loadingText}>Verifying access...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Access denied state ───────────────────────────────────────────────────────
  if (memberStatus !== 'approved') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <MatrixBackground />
        {renderNavHeader()}
        <View style={styles.centeredContainer}>
          <GlassPanel>
            <Text style={styles.lockedIcon}>🔒</Text>
            <Text style={styles.lockedTitle}>Access Restricted</Text>
            <Text style={styles.lockedText}>
              {memberStatus === 'pending'
                ? 'Your join request is awaiting Admin approval.'
                : 'You must be an approved member to access this chat.'}
            </Text>
          </GlassPanel>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Main chat view ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <MatrixBackground />
      {renderNavHeader()}

      {/*
        KeyboardAvoidingView configuration:
        - iOS: 'padding' mode pushes content up when keyboard appears.
          keyboardVerticalOffset=90 accounts for the 60px nav header + safe area.
        - Android: undefined behavior (OS handles it natively via windowSoftInputMode).
      */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Virtualized FlatList — view recycling prevents OOM on high-volume chats.
             Data is ordered ASC from Firestore; scroll-to-end pinned via
             onContentSizeChange + onLayout so newest messages always appear at bottom. */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isMe={item.user_id === currentUser?.uid}
            />
          )}
          // Scroll to bottom whenever list height changes (new message appended)
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          // Scroll to bottom on initial layout so user sees latest messages first
          onLayout={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          // Virtualization tuning — balances smoothness vs memory on low-tier Android
          initialNumToRender={20}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.flatList}
          contentContainerStyle={styles.flatListContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No messages yet. Say hello! 👋</Text>
            </View>
          }
        />

        {/* Fixed input bar — pinned above keyboard */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Message the community..."
            placeholderTextColor="#6b7280"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || isSending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || isSending}
            activeOpacity={0.8}
          >
            {isSending
              ? <ActivityIndicator color="#ffffff" size="small" />
              : <Text style={styles.sendBtnText}>➤</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },

  // Glass Panel
  glassPanelOuter: {
    borderRadius: 20,
    overflow: 'hidden',
    width: '100%',
  },
  glassBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  glassPanelInner: {
    padding: 24,
    alignItems: 'center',
  },

  // Navigation Header
  navHeader: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(15,15,26,0.9)',
  },
  backBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a78bfa',
  },
  headerTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: '#f0f0ff',
    zIndex: -1,
  },
  headerSpacer: {
    minWidth: 44,
  },

  // States
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  lockedIcon: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 12,
  },
  lockedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f0f0ff',
    marginBottom: 8,
    textAlign: 'center',
  },
  lockedText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 15,
    fontStyle: 'italic',
  },

  // Chat layout
  flatList: {
    flex: 1,
  },
  flatListContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },

  // Message bubbles — Liquid Glass dark neo-morphic
  msgWrapper: {
    marginBottom: 16,
  },
  msgWrapperMe: {
    alignItems: 'flex-end',
  },
  msgWrapperThem: {
    alignItems: 'flex-start',
  },
  senderName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
    marginLeft: 4,
    letterSpacing: 0.3,
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  bubbleMe: {
    // Primary purple — "sent" state
    backgroundColor: '#7c3aed',
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    // Dark neo-morphic glass — "received" state
    backgroundColor: 'rgba(20, 20, 30, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
  },

  // Input bar — fixed above keyboard
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0f0f1a',
  },
  input: {
    flex: 1,
    minHeight: 52,
    maxHeight: 120,
    borderRadius: 26,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 14 : 10,
    paddingBottom: Platform.OS === 'ios' ? 14 : 10,
    backgroundColor: 'rgba(20, 20, 30, 0.9)',
    color: '#ffffff',
    fontSize: 16,
    marginRight: 12,
  },
  sendBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
});
