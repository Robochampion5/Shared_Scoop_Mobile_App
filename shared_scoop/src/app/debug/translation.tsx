// src/app/debug/translation.tsx — Sarvam AI Translation Verification Engine
//
// PURPOSE: Developer/QA screen to:
//   1. Confirm the SARVAM_API_KEY is correctly configured in Vercel.
//   2. Measure real network latency to determine viability for real-time chat.
//   3. Verify correct output across all 11 Sarvam language targets.
//
// ARCHITECTURAL CONSTRAINTS:
//   - Relative imports only (no @/ aliases)
//   - Liquid Glass theme: MatrixBackground + LiquidCard
//   - No onSnapshot listeners (no Firestore reads on this screen)
//   - Hermes-safe: no ES2022 private class fields
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  translateWithSarvam,
  SARVAM_LANGUAGES,
  SarvamLangCode,
  SarvamError,
} from '../../lib/sarvam';
import MatrixBackground from '../../components/MatrixBackground';
import LiquidCard from '../../components/LiquidCard';

// ─── Types ────────────────────────────────────────────────────────────────────
interface TranslationResult {
  lang: SarvamLangCode;
  langLabel: string;
  translatedText: string;
  latencyMs: number;
  status: 'success' | 'error';
  error?: SarvamError;
}

// ─── Latency rating thresholds (ms) ──────────────────────────────────────────
function getLatencyRating(ms: number): { label: string; color: string } {
  if (ms < 800)  return { label: '⚡ Excellent', color: '#34d399' };
  if (ms < 1800) return { label: '✅ Viable',    color: '#84cc16' };
  if (ms < 3500) return { label: '⚠️ Marginal',  color: '#f59e0b' };
  return               { label: '🔴 Too Slow',   color: '#ef4444' };
}

// ─── Error code display map ───────────────────────────────────────────────────
const ERROR_CODE_LABELS: Record<string, string> = {
  UNAUTHORIZED:    '🔐 API Key Invalid (401)',
  RATE_LIMITED:    '🚦 Rate Limited (429)',
  SERVER_ERROR:    '💥 Server Error (5xx)',
  NETWORK_TIMEOUT: '⏱ Network Timeout',
  PARSE_ERROR:     '🔣 Parse Error',
  UNKNOWN:         '❓ Unknown Error',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function TranslationDebugScreen() {
  const router = useRouter();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [sourceText, setSourceText] = useState(
    'SharedScoop connects communities to order wholesale supplements together.'
  );
  const [selectedLangs, setSelectedLangs] = useState<Set<SarvamLangCode>>(
    new Set(['hi-IN', 'kn-IN', 'ta-IN'])
  );

  // ── Execution state ─────────────────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<TranslationResult[]>([]);

  // Abort mid-matrix run
  const abortRef = useRef(false);

  // ── Language selector toggle ─────────────────────────────────────────────────
  const toggleLang = useCallback((code: SarvamLangCode) => {
    setSelectedLangs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        // Enforce minimum 1 selection
        if (next.size > 1) next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedLangs(new Set(SARVAM_LANGUAGES.map((l) => l.code)));
  }, []);

  const selectNone = useCallback(() => {
    setSelectedLangs(new Set(['hi-IN']));
  }, []);

  // ── Translation matrix runner ────────────────────────────────────────────────
  const handleRunMatrix = useCallback(async () => {
    if (isRunning) return;

    const text = sourceText.trim();
    if (!text) {
      Alert.alert('Input Required', 'Enter a source string to translate.');
      return;
    }
    if (selectedLangs.size === 0) {
      Alert.alert('Select Languages', 'Select at least one target language.');
      return;
    }

    abortRef.current = false;
    setIsRunning(true);
    setResults([]);

    const targets = SARVAM_LANGUAGES.filter((l) => selectedLangs.has(l.code));

    // Run sequentially to avoid hammering the rate limiter
    for (let i = 0; i < targets.length; i++) {
      if (abortRef.current) break;

      const { code, label } = targets[i];
      setProgress(`Translating [${i + 1}/${targets.length}] → ${label}...`);

      try {
        const { translatedText, latencyMs } = await translateWithSarvam(text, code);
        setResults((prev) => [
          ...prev,
          { lang: code, langLabel: label, translatedText, latencyMs, status: 'success' },
        ]);
      } catch (err: unknown) {
        const sarvamErr = err as SarvamError;
        setResults((prev) => [
          ...prev,
          {
            lang: code,
            langLabel: label,
            translatedText: '',
            latencyMs: 0,
            status: 'error',
            error: sarvamErr,
          },
        ]);

        // Hard stop on 401 — all subsequent requests will also fail
        if (sarvamErr.code === 'UNAUTHORIZED') {
          Alert.alert(
            '🔐 API Key Invalid',
            'Received HTTP 401. Set SARVAM_API_KEY in the Vercel dashboard and redeploy.\n\nAborting matrix run.'
          );
          abortRef.current = true;
          break;
        }

        // Hard stop on 429 — server is rate limiting, rest will fail
        if (sarvamErr.code === 'RATE_LIMITED') {
          Alert.alert(
            '🚦 Rate Limited',
            'Sarvam API rate limit hit. Wait 60 seconds and retry.\n\nAborting matrix run.'
          );
          abortRef.current = true;
          break;
        }
        // Other errors: log result and continue to next language
      }
    }

    setProgress('');
    setIsRunning(false);
  }, [isRunning, sourceText, selectedLangs]);

  const handleAbort = useCallback(() => {
    abortRef.current = true;
    setProgress('Aborting after current request...');
  }, []);

  // ── Aggregate stats ──────────────────────────────────────────────────────────
  const successResults = results.filter((r) => r.status === 'success');
  const avgLatency =
    successResults.length > 0
      ? Math.round(successResults.reduce((sum, r) => sum + r.latencyMs, 0) / successResults.length)
      : null;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f1a" />
      <MatrixBackground />

      {/* ── Navigation header ─────────────────────────────────────────────── */}
      <View style={styles.navHeader}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          disabled={isRunning}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Translation Engine</Text>
        <View style={styles.devBadge}>
          <Text style={styles.devBadgeText}>DEV</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Source Input ────────────────────────────────────────────────── */}
          <LiquidCard intensity={50}>
            <Text style={styles.sectionTitle}>Source Text</Text>
            <Text style={styles.sectionSubtitle}>
              English input — max ~5,000 chars (Sarvam limit)
            </Text>
            <TextInput
              style={styles.sourceInput}
              value={sourceText}
              onChangeText={setSourceText}
              placeholder="Enter text to translate..."
              placeholderTextColor="#4b5563"
              multiline
              numberOfLines={5}
              editable={!isRunning}
              textAlignVertical="top"
              maxLength={5000}
            />
            <Text style={styles.charCount}>{sourceText.length} / 5000 chars</Text>
          </LiquidCard>

          {/* ── Language Selector ───────────────────────────────────────────── */}
          <LiquidCard intensity={50}>
            <View style={styles.selectorHeader}>
              <Text style={styles.sectionTitle}>Target Languages</Text>
              <View style={styles.selectorActions}>
                <TouchableOpacity onPress={selectAll} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                  <Text style={styles.selectorActionText}>All</Text>
                </TouchableOpacity>
                <Text style={styles.selectorActionDivider}>|</Text>
                <TouchableOpacity onPress={selectNone} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                  <Text style={styles.selectorActionText}>Reset</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.langGrid}>
              {SARVAM_LANGUAGES.map(({ code, label }) => {
                const active = selectedLangs.has(code);
                return (
                  <Pressable
                    key={code}
                    onPress={() => toggleLang(code)}
                    disabled={isRunning}
                    style={[styles.langChip, active && styles.langChipActive]}
                  >
                    <Text style={[styles.langChipText, active && styles.langChipTextActive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.langCount}>
              {selectedLangs.size} language{selectedLangs.size !== 1 ? 's' : ''} selected
            </Text>
          </LiquidCard>

          {/* ── Run Button ──────────────────────────────────────────────────── */}
          {!isRunning ? (
            <TouchableOpacity
              style={styles.runButton}
              onPress={handleRunMatrix}
              activeOpacity={0.85}
            >
              <Text style={styles.runButtonText}>
                ▶ Run Translation Matrix ({selectedLangs.size} targets)
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.runningContainer}>
              <ActivityIndicator color="#7c3aed" size="small" />
              <Text style={styles.progressText} numberOfLines={1}>{progress}</Text>
              <TouchableOpacity onPress={handleAbort} style={styles.abortButton}>
                <Text style={styles.abortButtonText}>Abort</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Aggregate Stats ─────────────────────────────────────────────── */}
          {results.length > 0 && (
            <LiquidCard intensity={40}>
              <Text style={styles.sectionTitle}>Matrix Summary</Text>
              <View style={styles.statsRow}>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{results.length}</Text>
                  <Text style={styles.statLabel}>Runs</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={[styles.statValue, { color: '#34d399' }]}>
                    {successResults.length}
                  </Text>
                  <Text style={styles.statLabel}>Passed</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={[styles.statValue, { color: '#ef4444' }]}>
                    {results.length - successResults.length}
                  </Text>
                  <Text style={styles.statLabel}>Failed</Text>
                </View>
                {avgLatency !== null && (
                  <View style={styles.statCell}>
                    <Text
                      style={[styles.statValue, { color: getLatencyRating(avgLatency).color }]}
                    >
                      {avgLatency}ms
                    </Text>
                    <Text style={styles.statLabel}>Avg Latency</Text>
                  </View>
                )}
              </View>

              {avgLatency !== null && (
                <View style={styles.verdictRow}>
                  <Text style={styles.verdictLabel}>Real-time Chat Viability: </Text>
                  <Text
                    style={[
                      styles.verdictValue,
                      { color: getLatencyRating(avgLatency).color },
                    ]}
                  >
                    {getLatencyRating(avgLatency).label}
                  </Text>
                </View>
              )}
              {avgLatency !== null && avgLatency >= 1800 && (
                <Text style={styles.verdictNote}>
                  ⚠️ Latency exceeds 1800ms. Translate on send (async background task) rather
                  than blocking the message input. Cache results in Firestore per sender language.
                </Text>
              )}
            </LiquidCard>
          )}

          {/* ── Per-language Results ────────────────────────────────────────── */}
          {results.map((result) => (
            <LiquidCard
              key={result.lang}
              intensity={40}
              style={
                (result.status === 'error'
                  ? styles.resultCardError
                  : styles.resultCardSuccess) as any
              }
            >
              {/* Header row */}
              <View style={styles.resultHeader}>
                <View style={styles.resultLangBadge}>
                  <Text style={styles.resultLangCode}>{result.lang}</Text>
                </View>
                <Text style={styles.resultLangLabel}>{result.langLabel}</Text>
                <View style={styles.resultHeaderRight}>
                  {result.status === 'success' && (
                    <>
                      <Text
                        style={[
                          styles.resultLatency,
                          { color: getLatencyRating(result.latencyMs).color },
                        ]}
                      >
                        {result.latencyMs}ms
                      </Text>
                      <Text
                        style={[
                          styles.resultRating,
                          { color: getLatencyRating(result.latencyMs).color },
                        ]}
                      >
                        {getLatencyRating(result.latencyMs).label}
                      </Text>
                    </>
                  )}
                  {result.status === 'error' && (
                    <Text style={styles.resultErrorBadge}>
                      {ERROR_CODE_LABELS[result.error?.code ?? 'UNKNOWN']}
                    </Text>
                  )}
                </View>
              </View>

              {/* Output */}
              {result.status === 'success' && (
                <Text style={styles.resultText}>{result.translatedText}</Text>
              )}
              {result.status === 'error' && (
                <>
                  <Text style={styles.resultErrorMessage}>
                    {result.error?.message ?? 'Unknown error'}
                  </Text>
                  {result.error?.raw && (
                    <Text style={styles.resultErrorRaw} numberOfLines={3}>
                      Raw: {result.error.raw}
                    </Text>
                  )}
                </>
              )}
            </LiquidCard>
          ))}

          {/* Bottom padding for keyboard */}
          <View style={{ height: 40 }} />
        </ScrollView>
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

  // Nav header
  navHeader: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(15,15,26,0.95)',
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a78bfa',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#f0f0ff',
  },
  devBadge: {
    backgroundColor: 'rgba(234,179,8,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.35)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  devBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#eab308',
    letterSpacing: 1,
  },

  // Scroll
  content: {
    padding: 16,
    gap: 4,
  },

  // Section typography
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#f0f0ff',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 12,
  },

  // Source input
  sourceInput: {
    backgroundColor: 'rgba(15,15,26,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#f0f0ff',
    minHeight: 110,
    lineHeight: 22,
  },
  charCount: {
    fontSize: 11,
    color: '#4b5563',
    textAlign: 'right',
    marginTop: 6,
  },

  // Language selector
  selectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  selectorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectorActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
  },
  selectorActionDivider: {
    color: '#374151',
    fontSize: 12,
  },
  langGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 10,
  },
  langChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  langChipActive: {
    backgroundColor: 'rgba(124,58,237,0.2)',
    borderColor: 'rgba(124,58,237,0.5)',
  },
  langChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  langChipTextActive: {
    color: '#a78bfa',
  },
  langCount: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },

  // Run button
  runButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 16,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  runButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  runningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.2)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    marginVertical: 8,
  },
  progressText: {
    flex: 1,
    fontSize: 13,
    color: '#a78bfa',
    fontWeight: '500',
  },
  abortButton: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  abortButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ef4444',
  },

  // Stats summary
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
    marginBottom: 12,
  },
  statCell: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f0f0ff',
  },
  statLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  verdictLabel: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '500',
  },
  verdictValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  verdictNote: {
    fontSize: 12,
    color: '#f59e0b',
    lineHeight: 18,
    marginTop: 6,
    backgroundColor: 'rgba(245,158,11,0.06)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.15)',
  },

  // Result cards
  resultCardSuccess: {
    borderColor: 'rgba(52,211,153,0.15)',
    borderWidth: 1,
  },
  resultCardError: {
    borderColor: 'rgba(239,68,68,0.2)',
    borderWidth: 1,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
    flexWrap: 'nowrap',
  },
  resultLangBadge: {
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  resultLangCode: {
    fontSize: 10,
    fontWeight: '800',
    color: '#a78bfa',
    letterSpacing: 0.5,
  },
  resultLangLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f0f0ff',
    flexShrink: 1,
  },
  resultHeaderRight: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  resultLatency: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
  },
  resultRating: {
    fontSize: 10,
    fontWeight: '600',
  },
  resultErrorBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ef4444',
    textAlign: 'right',
  },
  resultText: {
    fontSize: 15,
    color: '#e5e7eb',
    lineHeight: 24,
    fontWeight: '400',
  },
  resultErrorMessage: {
    fontSize: 13,
    color: '#ef4444',
    lineHeight: 20,
    fontWeight: '500',
  },
  resultErrorRaw: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 6,
    padding: 8,
  },
});
