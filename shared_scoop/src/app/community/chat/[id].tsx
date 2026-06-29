// Author: Adarsh Singh | Roll No: IC2025006
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, FlatList, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp, where } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from '../../../lib/firebase';
import MatrixBackground from '../../../components/MatrixBackground';
import LiquidCard from '../../../components/LiquidCard';

interface Message {
  id: string;
  text: string;
  sender_uid: string;
  sender_name?: string;
  timestamp: any;
}

export default function CommunityChatScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const communityId = typeof id === 'string' ? id : '';

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [memberStatus, setMemberStatus] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser || !communityId) {
      setLoadingStatus(false);
      return;
    }
    
    setLoadingStatus(true);
    const membershipQuery = query(
      collection(db, 'memberships'),
      where('community_id', '==', communityId),
      where('user_id', '==', currentUser.uid),
      limit(1)
    );
    
    const unsubMembership = onSnapshot(membershipQuery, (snapshot) => {
      if (!snapshot.empty) {
        setMemberStatus(snapshot.docs[0].data().status);
      } else {
        setMemberStatus(null);
      }
      setLoadingStatus(false);
    }, (error) => {
      console.warn("Access restricted:", error.message);
      setLoadingStatus(false);
    });
    
    return () => unsubMembership();
  }, [currentUser, communityId]);

  useEffect(() => {
    if (!communityId || memberStatus !== 'approved') return;

    const messagesRef = collection(db, 'communities', communityId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(50));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: Message[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(fetched);
    }, (error) => {
      console.warn("Access restricted:", error.message);
    });

    return () => unsubscribe();
  }, [communityId, memberStatus]);

  const handleSend = async () => {
    if (!inputText.trim() || !currentUser || !communityId) return;

    const textToSend = inputText.trim();
    setInputText('');
    setIsSending(true);

    try {
      await addDoc(collection(db, 'communities', communityId, 'messages'), {
        text: textToSend,
        sender_uid: currentUser.uid,
        sender_name: currentUser.displayName || 'Anonymous',
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsSending(false);
    }
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.sender_uid === currentUser?.uid;

    return (
      <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowThem]}>
        {!isMe && (
          <View style={styles.senderNameContainer}>
            <Text style={styles.senderNameText}>{item.sender_name || 'Anonymous'}</Text>
          </View>
        )}
        <View style={[styles.messageBubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          <Text style={styles.messageText}>{item.text}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <MatrixBackground />
      
      <View style={styles.navHeader}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Community Chat</Text>
        <View style={{ width: 60 }} />
      </View>

      {loadingStatus ? (
        <View style={styles.centeredContainer}>
          <Text style={styles.loadingText}>Verifying access...</Text>
        </View>
      ) : memberStatus !== 'approved' ? (
        <View style={styles.centeredContainer}>
          <LiquidCard intensity={40} style={styles.lockedCard}>
            <Text style={styles.lockedIcon}>🔒</Text>
            <Text style={styles.lockedText}>Your request to join this group buy is pending Admin approval.</Text>
          </LiquidCard>
        </View>
      ) : (
        <KeyboardAvoidingView 
          style={styles.container} 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <FlatList
            inverted
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Type a message..."
              placeholderTextColor="#6b7280"
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={500}
            />
            <TouchableOpacity 
              style={[styles.sendButton, (!inputText.trim() || isSending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim() || isSending}
              activeOpacity={0.8}
            >
              <Text style={styles.sendButtonText}>{isSending ? '...' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  navHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0f0f1a',
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a78bfa',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f0f0ff',
  },
  container: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    gap: 12,
  },
  messageRow: {
    flexDirection: 'column',
    width: '100%',
    marginBottom: 8,
  },
  messageRowMe: {
    alignItems: 'flex-end',
  },
  messageRowThem: {
    alignItems: 'flex-start',
  },
  senderNameContainer: {
    marginBottom: 2,
    marginLeft: 4,
  },
  senderNameText: {
    color: '#9ca3af',
    fontSize: 11,
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  bubbleMe: {
    backgroundColor: '#7c3aed',
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  messageText: {
    color: '#f0f0ff',
    fontSize: 15,
    lineHeight: 22,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  lockedCard: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
  },
  lockedIcon: {
    fontSize: 48,
    textAlign: 'center',
    textShadowColor: 'rgba(124, 58, 237, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  lockedText: {
    color: '#f0f0ff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: 'rgba(15, 15, 26, 0.9)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(20, 20, 30, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 48,
    maxHeight: 120,
    fontSize: 15,
    color: '#f0f0ff',
    marginRight: 12,
  },
  sendButton: {
    backgroundColor: '#7c3aed',
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
