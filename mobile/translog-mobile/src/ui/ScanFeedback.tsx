/**
 * ScanFeedback — Retour visuel + tactile sans Alert.alert.
 *
 * Pourquoi un composant dédié :
 *   - Alert.alert ne s'affiche pas sur react-native-web (Expo Web) et nécessite
 *     un tap pour être fermé — pas adapté au scan rafale.
 *   - On veut un feedback **à la Shopify POS** : banner coloré plein écran,
 *     auto-dismiss ~2s, + vibration tactile (réussite/échec).
 *   - Centralisé = pas de duplication dans BoardingScanScreen, QuaiBulkScan,
 *     ParcelScan, QuaiHomeScreen, StationHomeScreen.
 *
 * Cross-platform :
 *   - Vibration : API native RN (disponible iOS/Android, no-op sur web)
 *   - Web beep  : WebAudio API si disponible — aucun fichier son requis
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, Vibration } from 'react-native';

export type ScanFeedbackKind = 'success' | 'warning' | 'error' | 'info';

export interface ScanToast {
  kind:     ScanFeedbackKind;
  title:    string;
  subtitle?: string;
  /** ms avant disparition auto (défaut 2000). 0 = persistant jusqu'au prochain show. */
  durationMs?: number;
}

// Motifs de vibration par type — l'agent distingue OK/KO au toucher sans
// avoir à regarder l'écran (utile quand il scanne tête baissée sur 200 billets).
const VIBRATION_PATTERN: Record<ScanFeedbackKind, number | number[]> = {
  success: 80,               // tap bref
  warning: [0, 60, 80, 60],  // double-tap
  error:   [0, 120, 80, 120, 80, 120], // triple-tap long
  info:    40,
};

// Fréquences en Hz pour le beep Web (inaudible si le navigateur bloque l'audio
// avant une interaction utilisateur — le scan est justement une interaction).
const WEB_BEEP_HZ: Record<ScanFeedbackKind, number> = {
  success: 880,  // La aigu = OK
  warning: 440,  // La médium = attention
  error:   220,  // La grave = KO
  info:    660,
};

/**
 * Joue un court beep via WebAudio — aucun fichier son, aucun package.
 * No-op sur native (window indéfini ou AudioContext absent).
 */
function webBeep(kind: ScanFeedbackKind, durationMs = 140) {
  if (Platform.OS !== 'web') return;
  try {
    const w = window as typeof window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = WEB_BEEP_HZ[kind];
    gain.gain.value = 0.08;  // volume discret (pas 100% pour ne pas saouler l'agent)
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close().catch(() => { /* no-op */ });
    }, durationMs);
  } catch { /* navigateur sans AudioContext — tant pis, la vibration/visuel suffisent */ }
}

/**
 * Hook qui expose `show()` pour poser une notification, et `toast` à rendre
 * via <ScanToastBanner />. Gère l'auto-dismiss + la vibration + le beep.
 */
export function useScanFeedback() {
  const [toast, setToast] = useState<ScanToast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((t: ScanToast) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(t);

    // Vibration (native) + beep (web). Les deux sont fire-and-forget.
    try { Vibration.vibrate(VIBRATION_PATTERN[t.kind] as number); } catch { /* ignore */ }
    webBeep(t.kind);

    const ms = t.durationMs ?? 2000;
    if (ms > 0) {
      timerRef.current = setTimeout(() => setToast(null), ms);
    }
  }, []);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { toast, show, dismiss };
}

// Palette — intentionnellement franche, pour que l'agent voie le résultat à 1m.
const TONE: Record<ScanFeedbackKind, { bg: string; fg: string; border: string }> = {
  success: { bg: '#10b981', fg: '#ffffff', border: '#059669' },
  warning: { bg: '#f59e0b', fg: '#1f2937', border: '#d97706' },
  error:   { bg: '#ef4444', fg: '#ffffff', border: '#dc2626' },
  info:    { bg: '#3b82f6', fg: '#ffffff', border: '#2563eb' },
};

export function ScanToastBanner({ toast }: { toast: ScanToast | null }) {
  if (!toast) return null;
  const tone = TONE[toast.kind];
  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: tone.bg, borderColor: tone.border }]}
    >
      <Text style={[styles.title, { color: tone.fg }]}>{toast.title}</Text>
      {toast.subtitle ? (
        <Text style={[styles.subtitle, { color: tone.fg }]} numberOfLines={2}>
          {toast.subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Position fixée en haut sous le header — zone où l'œil va naturellement
  // après un scan. `elevation` + `shadow*` pour être au-dessus des listes.
  banner: {
    position: 'absolute',
    top:      Platform.OS === 'ios' ? 110 : 80,
    left:     16,
    right:    16,
    zIndex:   999,
    borderRadius:    14,
    borderWidth:     2,
    paddingVertical:   14,
    paddingHorizontal: 18,
    shadowColor:      '#000',
    shadowOpacity:    0.25,
    shadowRadius:     12,
    shadowOffset:     { width: 0, height: 4 },
    elevation:        8,
  },
  title:    { fontSize: 18, fontWeight: '800', letterSpacing: 0.3 },
  subtitle: { fontSize: 13, fontWeight: '600', marginTop: 4, opacity: 0.95 },
});
