/**
 * <QrScanner /> — Modal réutilisable d'activation caméra + scan QR.
 *
 * Contrat :
 *   - visible         : ouvre le modal plein écran
 *   - onScanned(data) : callback appelé UNE fois (anti double-scan), ferme le modal
 *   - onClose         : fermeture manuelle sans scan
 *
 * Sécurité / UX :
 *   - Demande la permission à l'ouverture, message explicite si refusé.
 *   - Double-scan protégé (scanning lock) — l'utilisateur n'émet jamais deux fois
 *     la même validation accidentelle (important pour verify-qr avec idempotency).
 *   - Barre de ciblage visuelle centrée, cache-flash pour guider l'utilisateur.
 *   - i18n : fr/en seulement pour l'instant (autres locales = TODO Sprint i18n).
 *
 * Compatibilité : iOS 13+, Android 6+ (caméra obligatoire, permission runtime).
 */

import { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, Linking, Platform, TextInput,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/useI18n';

// Constantes UX — pas de magic numbers dans le render.
const SCAN_RESET_DELAY_MS = 1_500; // anti double-scan UX
const TARGET_SIZE         = 240;   // carré de visée (px)

export interface QrScannerProps {
  visible:    boolean;
  onScanned:  (data: string) => void;
  onClose:    () => void;
  /**
   * Mode "rafale" : ne ferme pas la caméra après un scan. Utilisé par l'agent
   * de quai qui enchaîne 50-200 billets. Le debounce de SCAN_RESET_DELAY_MS
   * continue à empêcher le double-scan du MÊME QR.
   */
  persistent?: boolean;
}

export function QrScanner({ visible, onScanned, onClose, persistent }: QrScannerProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked]           = useState(false);
  const [manualMode, setManualMode]   = useState(false);
  const [manualCode, setManualCode]   = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setLocked(false);
      setManualMode(false);
      setManualCode('');
      setCameraError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (visible && permission?.granted === false && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  function handleBarcode(result: BarcodeScanningResult) {
    if (locked) return;
    setLocked(true);
    const value = result.data?.trim();
    if (!value) {
      setTimeout(() => setLocked(false), SCAN_RESET_DELAY_MS);
      return;
    }
    // Debounce le reset pour éviter qu'un 2e scan identique remonte à l'app.
    // En mode persistent la caméra reste ouverte — c'est le callback qui
    // décide de ne pas fermer la modale (cf. onScanned).
    setTimeout(() => setLocked(false), SCAN_RESET_DELAY_MS);
    onScanned(value);
  }

  function submitManual() {
    const code = manualCode.trim();
    if (!code) return;
    onScanned(code);
    setManualCode('');
  }

  // persistent est uniquement informationnel pour le consumer : il sait qu'il
  // ne doit pas fermer la modale après onScanned. Rien à changer dans le modal.
  void persistent;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {!permission && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {permission && !permission.granted && (
          <View style={styles.center}>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('qr.permissionTitle') ?? 'Autorisation caméra requise'}
            </Text>
            <Text style={[styles.body, { color: colors.textMuted }]}>
              {t('qr.permissionBody') ?? 'TransLog Pro a besoin d\'accéder à la caméra pour scanner les billets.'}
            </Text>
            {permission.canAskAgain ? (
              <Pressable
                onPress={requestPermission}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                  {t('qr.permissionAsk') ?? 'Autoriser la caméra'}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => Linking.openSettings()}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                  {t('qr.openSettings') ?? 'Ouvrir les réglages'}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={[styles.btnGhost, { borderColor: colors.border }]}
            >
              <Text style={{ color: colors.text }}>
                {t('common.cancel') ?? 'Annuler'}
              </Text>
            </Pressable>
          </View>
        )}

        {permission?.granted && !manualMode && (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              // iOS ratio 16:9 par défaut ; Android gère automatiquement.
              barcodeScannerSettings={{
                barcodeTypes: ['qr', 'code128', 'pdf417', 'datamatrix'],
              }}
              onBarcodeScanned={handleBarcode}
              onMountError={(e) => {
                // Remonte à l'UI toute erreur native (module manquant, lentille
                // inaccessible, conflit de session caméra…). Sans ça l'agent
                // voit juste un écran noir sans comprendre pourquoi ça ne scanne pas.
                setCameraError(e?.message ?? 'Caméra indisponible');
              }}
            />
            {/* `pointerEvents` est déprécié en prop côté react-native-web —
                on passe via le style. 'box-none' permet les clicks dans les
                enfants (Pressable) tout en laissant traverser la caméra. */}
            <View style={[styles.overlay, { pointerEvents: 'box-none' }]}>
              <View style={[styles.target, { width: TARGET_SIZE, height: TARGET_SIZE, borderColor: colors.primaryFg }]} />
              <Text style={styles.hint}>
                {t('qr.hint') ?? 'Centrez le QR code dans le cadre'}
              </Text>
              {cameraError && (
                <View style={[styles.errorBanner, { pointerEvents: 'none' }]}>
                  <Text style={styles.errorText}>⚠ {cameraError}</Text>
                </View>
              )}
              {/* Bouton saisie manuelle — toujours accessible, utile quand le
                  QR est abîmé ou que la caméra a du mal à faire la mise au point. */}
              <Pressable
                onPress={() => setManualMode(true)}
                accessibilityRole="button"
                accessibilityLabel={t('qr.switchManual') ?? 'Saisir manuellement'}
                style={[styles.manualBtn, { backgroundColor: colors.surface }]}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  ⌨  {t('qr.switchManual') ?? 'Saisir manuellement'}
                </Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel') ?? 'Annuler'}
                style={styles.closeBtn}
              >
                <Text style={{ color: '#fff', fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>
          </>
        )}

        {manualMode && (
          <View style={styles.center}>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('qr.manualTitle') ?? 'Saisir le code du billet ou colis'}
            </Text>
            <Text style={[styles.body, { color: colors.textMuted }]}>
              {t('qr.manualBody') ?? 'Tapez ou collez le code imprimé sous le QR (ex. cmo... ou TRK-...).'}
            </Text>
            <TextInput
              value={manualCode}
              onChangeText={setManualCode}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('qr.manualPlaceholder') ?? 'Code ticket ou colis'}
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={submitManual}
              style={{
                width: '100%',
                maxWidth: 360,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                color: colors.text,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              }}
            />
            <Pressable
              onPress={submitManual}
              disabled={!manualCode.trim()}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: colors.primary, opacity: !manualCode.trim() || pressed ? 0.5 : 1 },
              ]}
            >
              <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                {t('qr.validateManual') ?? 'Valider'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setManualMode(false)}
              accessibilityRole="button"
              style={[styles.btnGhost, { borderColor: colors.border }]}
            >
              <Text style={{ color: colors.text }}>
                {t('qr.backToCamera') ?? 'Revenir au scanner'}
              </Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={[styles.btnGhost, { borderColor: colors.border }]}
            >
              <Text style={{ color: colors.textMuted }}>
                {t('common.cancel') ?? 'Annuler'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:     { flex: 1 },
  center:   { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 12 },
  title:    { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  body:     { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  btn:      { minHeight: 48, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  btnGhost: { minHeight: 44, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginTop: 4 },
  overlay:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  target:   { borderWidth: 3, borderRadius: 16, backgroundColor: 'transparent' },
  hint:     { color: '#fff', marginTop: 16, fontSize: 14, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  closeBtn: {
    position: 'absolute',
    top:      Platform.OS === 'ios' ? 56 : 16,
    right:    16,
    width:    44, height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  manualBtn: {
    position: 'absolute',
    bottom:   Platform.OS === 'ios' ? 48 : 32,
    paddingHorizontal: 20,
    paddingVertical:   12,
    borderRadius:      24,
    shadowOpacity:     0.25,
    shadowRadius:      8,
    shadowOffset:      { width: 0, height: 2 },
    elevation:         4,
  },
  errorBanner: {
    position:      'absolute',
    top:           Platform.OS === 'ios' ? 100 : 60,
    left:          16,
    right:         16,
    backgroundColor: 'rgba(220,38,38,0.92)',
    paddingVertical:   10,
    paddingHorizontal: 14,
    borderRadius:   10,
  },
  errorText: {
    color:   '#fff',
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
});
