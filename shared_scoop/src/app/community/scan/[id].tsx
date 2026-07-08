// scan/[id].tsx — Admin QR Fulfillment Scanner
//
// SECURITY MODEL:
//   - Only Admins should be routed here (enforced at call-site in [id].tsx).
//   - Scanned QR payload MUST contain an order_id that matches the route param.
//     Any mismatch is a cross-pool contamination attempt → hard reject.
//   - isProcessing mutex prevents rapid-fire frame reads from cascading
//     into multiple simultaneous Firestore writes.
//
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Alert,
  ActivityIndicator,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';

// ─── Screen Dimensions ───────────────────────────────────────────────────────
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
// The active scan frame is a square cut-out in the dark overlay
const FRAME_SIZE = SCREEN_W * 0.68;

// ─── QR Payload (must match PaymentTicket.tsx encoding) ──────────────────────
interface QRPayload {
  order_id: string;
  user_id: string;
  kg_committed: number;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ScanScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const routeOrderId = typeof id === 'string' ? id : '';

  // Camera permission hook (expo-camera SDK 54+)
  const [permission, requestPermission] = useCameraPermissions();

  // ── Scan state ──────────────────────────────────────────────────────────────
  // isProcessing is the mutex: once a QR is detected, we lock here until
  // the Alert is dismissed, preventing frame-by-frame cascade writes.
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const isProcessingRef = useRef(false); // Ref for synchronous guard inside callback

  // Keep ref in sync with state
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  // ─── Barcode Handler ─────────────────────────────────────────────────────────
  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    // MUTEX: Abort immediately if another scan is already being processed.
    // React state updates are async; use the ref for a synchronous guard.
    if (isProcessingRef.current) return;

    // Lock the scanner
    isProcessingRef.current = true;
    setIsProcessing(true);
    setLastResult(data);

    // ── STEP 1: Defensive JSON Parse ─────────────────────────────────────────
    let payload: QRPayload;
    try {
      payload = JSON.parse(data);
      if (!payload.order_id || !payload.user_id || payload.kg_committed == null) {
        throw new Error('Missing required fields in QR payload.');
      }
    } catch {
      // Not a SharedScoop QR — reject silently and resume scanning
      Alert.alert(
        '❌ Invalid QR Code',
        'This QR code was not issued by SharedScoop. Please scan a valid Payment Ticket.',
        [{ text: 'Scan Again', onPress: () => { isProcessingRef.current = false; setIsProcessing(false); } }]
      );
      return;
    }

    // ── STEP 2: Security Assertion (Cross-Pool Guard) ─────────────────────────
    // The scanned order_id MUST match the route param. Reject any foreign ticket.
    if (payload.order_id !== routeOrderId) {
      Alert.alert(
        '⛔ Wrong Pool',
        `This ticket belongs to a different pool.\n\nExpected: ${routeOrderId.slice(0, 10)}…\nGot: ${payload.order_id.slice(0, 10)}…`,
        [{ text: 'Scan Again', onPress: () => { isProcessingRef.current = false; setIsProcessing(false); } }]
      );
      return;
    }

    // ── STEP 3: Atomic Fulfillment ────────────────────────────────────────────
    // Query the contributions collection for this exact user + order combination.
    try {
      const q = query(
        collection(db, 'contributions'),
        where('order_id', '==', routeOrderId),
        where('user_id', '==', payload.user_id)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        Alert.alert(
          '⚠️ Pledge Not Found',
          'No contribution record found for this user in this pool. The ticket may be counterfeit or already removed.',
          [{ text: 'Scan Again', onPress: () => { isProcessingRef.current = false; setIsProcessing(false); } }]
        );
        return;
      }

      const contributionDoc = snap.docs[0];
      const currentStatus = contributionDoc.data().status;

      // Idempotency guard: do not double-fulfil
      if (currentStatus === 'fulfilled') {
        Alert.alert(
          '⚠️ Already Fulfilled',
          `This pledge of ${payload.kg_committed}kg has already been marked as collected.`,
          [{ text: 'Scan Again', onPress: () => { isProcessingRef.current = false; setIsProcessing(false); } }]
        );
        return;
      }

      // Execute the atomic status update
      await updateDoc(doc(db, 'contributions', contributionDoc.id), {
        status: 'fulfilled',
        fulfilled_at: new Date().toISOString(),
      });

      // ── STEP 4: Success — unblock isProcessing on alert dismissal ────────────
      Alert.alert(
        '✅ Verified & Fulfilled',
        `${payload.kg_committed}kg pledge confirmed.\nUser ID: …${payload.user_id.slice(-6)}\n\nStatus updated to FULFILLED.`,
        [
          {
            text: 'Scan Next',
            onPress: () => {
              // Unblock the scanner for the next ticket
              isProcessingRef.current = false;
              setIsProcessing(false);
              setLastResult(null);
            },
          },
          {
            text: 'Done',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (e: any) {
      console.error('[Scanner] Fulfillment error:', e.message);
      Alert.alert(
        'Fulfillment Error',
        e.message,
        [{ text: 'Retry', onPress: () => { isProcessingRef.current = false; setIsProcessing(false); } }]
      );
    }
  };

  // ─── Permission States ────────────────────────────────────────────────────────
  if (!permission) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <View style={styles.centeredContainer}>
          <ActivityIndicator color="#7c3aed" size="large" />
          <Text style={styles.bodyText}>Checking camera permissions...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        {renderNavHeader(router)}
        <View style={styles.centeredContainer}>
          {/* Liquid Glass permission card */}
          <View style={styles.glassCard}>
            <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={styles.glassBorder} />
            <View style={styles.glassInner}>
              <Text style={styles.permissionIcon}>📷</Text>
              <Text style={styles.permissionTitle}>Camera Access Required</Text>
              <Text style={styles.bodyText}>
                SharedScoop requires camera access to scan and verify QR Payment Tickets.
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={requestPermission}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryBtnText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Active Scanner View ───────────────────────────────────────────────────────
  return (
    <View style={styles.fullScreen}>
      <StatusBar barStyle="light-content" />

      {/* Live camera fills the full screen */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        // Restrict to QR only — rejects barcodes, data matrix, etc.
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={isProcessing ? undefined : handleBarCodeScanned}
      />

      {/* ── Liquid Glass Overlay ── ────────────────────────────────────────── */}
      {/* Four dark panels surround the scan frame, creating a spotlight effect */}
      {/* Top panel */}
      <View style={[styles.overlay, styles.overlayTop]} />
      {/* Middle row: left gap + scan frame + right gap */}
      <View style={styles.overlayMiddleRow}>
        <View style={styles.overlaySide} />
        {/* Scan frame — transparent window with glowing corner accents */}
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <View style={styles.overlaySide} />
      </View>
      {/* Bottom panel */}
      <View style={[styles.overlay, styles.overlayBottom]} />

      {/* ── HUD Header ────────────────────────────────────────────────────── */}
      <SafeAreaView style={styles.hudHeader} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backBtnText}>✕ Close</Text>
        </TouchableOpacity>
        <View style={styles.hudTitleContainer}>
          <Text style={styles.hudTitle}>QR Verifier</Text>
          <Text style={styles.hudSubtitle}>Admin Fulfillment Scanner</Text>
        </View>
      </SafeAreaView>

      {/* ── HUD Footer ────────────────────────────────────────────────────── */}
      <View style={styles.hudFooter} pointerEvents="none">
        {isProcessing ? (
          <View style={styles.processingBadge}>
            <ActivityIndicator color="#34d399" size="small" style={{ marginRight: 8 }} />
            <Text style={styles.processingText}>Verifying pledge...</Text>
          </View>
        ) : (
          <View style={styles.instructionBadge}>
            <Text style={styles.instructionText}>
              Point the camera at a SharedScoop Payment Ticket QR
            </Text>
          </View>
        )}

        <Text style={styles.orderIdLabel}>
          Pool: {routeOrderId ? `${routeOrderId.slice(0, 14)}…` : 'Unknown'}
        </Text>
      </View>
    </View>
  );
}

// ─── Nav Header (used only in permission / loading states) ────────────────────
function renderNavHeader(router: ReturnType<typeof useRouter>) {
  return (
    <View style={styles.navHeader}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.navTitle}>QR Verifier</Text>
      <View style={{ minWidth: 44 }} />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const OVERLAY_COLOR = 'rgba(8, 8, 16, 0.82)';
const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;
const CORNER_COLOR = '#7c3aed';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  fullScreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  // ── Liquid Glass permission card ──────────────────────────────────────────
  glassCard: {
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
  glassInner: {
    padding: 28,
    alignItems: 'center',
  },
  permissionIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#f0f0ff',
    marginBottom: 12,
    textAlign: 'center',
  },
  bodyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  primaryBtn: {
    backgroundColor: '#7c3aed',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    width: '100%',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Nav header ─────────────────────────────────────────────────────────────
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

  // ── Shared back button (used in both nav header and HUD) ───────────────────
  backBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a78bfa',
  },

  // ── Spotlight overlay panels ───────────────────────────────────────────────
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: OVERLAY_COLOR,
  },
  overlayTop: {
    top: 0,
    height: (SCREEN_H - FRAME_SIZE) / 2,
  },
  overlayBottom: {
    bottom: 0,
    height: (SCREEN_H - FRAME_SIZE) / 2,
  },
  overlayMiddleRow: {
    position: 'absolute',
    top: (SCREEN_H - FRAME_SIZE) / 2,
    left: 0,
    right: 0,
    height: FRAME_SIZE,
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: OVERLAY_COLOR,
  },

  // ── Scan frame ─────────────────────────────────────────────────────────────
  scanFrame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    // Frame is transparent (no background) — the camera shows through
  },
  // Purple corner accents — 4 corners, L-shaped using borderWidth tricks
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: CORNER_COLOR,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: 6,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: 6,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: 6,
  },

  // ── HUD elements ──────────────────────────────────────────────────────────
  hudHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 20 : 0,
    paddingBottom: 12,
    gap: 12,
  },
  hudTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  hudTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f0f0ff',
  },
  hudSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9ca3af',
    marginTop: 2,
  },
  hudFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 48 : 28,
    paddingHorizontal: 24,
    gap: 12,
  },
  processingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  processingText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#34d399',
  },
  instructionBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  instructionText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#d1d5db',
    textAlign: 'center',
    lineHeight: 18,
  },
  orderIdLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
