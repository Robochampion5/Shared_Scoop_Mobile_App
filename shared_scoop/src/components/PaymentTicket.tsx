// PaymentTicket.tsx — Liquid Glass QR payment credential card
// Renders a denormalized pledge record as a scannable QR ticket.
// The QR payload is a stringified JSON object so validators can
// parse it offline without a network round-trip.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import QRCode from 'react-native-qrcode-svg';

// ─── Props ────────────────────────────────────────────────────────────────────
interface PaymentTicketProps {
  orderId: string;
  userId: string;
  kgCommitted: number;
  memberName?: string;
}

// ─── QR Payload type (stringified into the QR matrix) ────────────────────────
interface QRPayload {
  order_id: string;
  user_id: string;
  kg_committed: number;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PaymentTicket({
  orderId,
  userId,
  kgCommitted,
  memberName,
}: PaymentTicketProps) {
  // Payload is deterministic — same inputs always produce the same QR.
  // Validators decode it and cross-reference Firestore to confirm payment status.
  const qrPayload: QRPayload = {
    order_id: orderId,
    user_id: userId,
    kg_committed: kgCommitted,
  };
  const qrValue = JSON.stringify(qrPayload);

  return (
    <View style={styles.outer}>
      {/* Liquid Glass layer: BlurView fills the container absolutely */}
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />

      {/* 1px white border at 0.08 opacity — Liquid Glass invariant */}
      <View style={styles.border} />

      {/* Ticket body */}
      <View style={styles.inner}>
        {/* Header */}
        <Text style={styles.headerLabel}>PAYMENT TICKET</Text>
        <Text style={styles.appName}>SharedScoop</Text>

        {/* Member info */}
        {memberName ? (
          <Text style={styles.memberName}>{memberName}</Text>
        ) : null}

        {/* QR Code — white background required for scanner contrast */}
        <View style={styles.qrWrapper}>
          <QRCode
            value={qrValue}
            size={180}
            color="#0f0f1a"
            backgroundColor="#ffffff"
            // ecl=H gives 30% error correction — survives minor print damage
            ecl="H"
          />
        </View>

        {/* Pledge detail pills */}
        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>ORDER</Text>
            <Text style={styles.pillValue} numberOfLines={1}>
              {orderId.slice(0, 10)}…
            </Text>
          </View>
          <View style={[styles.pill, styles.pillAccent]}>
            <Text style={styles.pillLabel}>COMMITTED</Text>
            <Text style={[styles.pillValue, styles.pillValueAccent]}>
              {kgCommitted} kg
            </Text>
          </View>
        </View>

        {/* Footer scan instruction */}
        <Text style={styles.footer}>
          Present this QR to your distributor for pickup verification
        </Text>
      </View>
    </View>
  );
}

// ─── Styles — Liquid Glass dark neo-morphic ───────────────────────────────────
const styles = StyleSheet.create({
  // Outer container: glass frame with 20px radius + 1px border at 0.08 opacity
  outer: {
    borderRadius: 20,
    overflow: 'hidden',
    width: '100%',
  },
  border: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  inner: {
    padding: 24,
    alignItems: 'center',
  },

  // Header text
  headerLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
    color: '#6b7280',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  appName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f0f0ff',
    marginBottom: 4,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a78bfa',
    marginBottom: 20,
  },

  // QR Code — white bg required for scanner contrast on dark surfaces
  qrWrapper: {
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },

  // Pill row
  pillRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
    width: '100%',
  },
  pill: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  pillAccent: {
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    borderColor: 'rgba(52, 211, 153, 0.2)',
  },
  pillLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#6b7280',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  pillValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f0f0ff',
  },
  pillValueAccent: {
    color: '#34d399',
  },

  // Footer
  footer: {
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 16,
  },
});
