/**
 * MobileSignatureInput — saisie signature mobile (briefing v2).
 *
 * Trois méthodes compatibles avec le payload v2 `{ method, blob }` :
 *   - DRAW      : pan tactile + react-native-svg → SVG string
 *   - PIN       : code 4-8 chiffres → sha-256 hex
 *   - BIOMETRIC : expo-local-authentication (FaceID/TouchID/Android bio)
 *
 * Pas de dépendances additionnelles (react-native-svg + PanResponder natifs,
 * expo-crypto / expo-local-authentication déjà au package.json).
 *
 * Test récursif dessin (exigence produit) : l'SVG est construit directement
 * à partir du tableau de points → peut être sérialisé, persisté en DB, puis
 * rendu via react-native-svg <SvgFromXml>. Procédure de validation manuelle
 * documentée dans docs/BRIEFING.md.
 */

import { useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, PanResponder,
  type PanResponderInstance, type GestureResponderEvent, type PanResponderGestureState,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Crypto from 'expo-crypto';
import * as LocalAuth from 'expo-local-authentication';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';

export type SignatureMethod = 'DRAW' | 'PIN' | 'BIOMETRIC';

export interface MobileSignatureValue {
  method:  SignatureMethod;
  blob:    string;
  isReady: boolean;
}

export interface MobileSignatureInputProps {
  value?:       MobileSignatureValue | null;
  onChange:     (v: MobileSignatureValue) => void;
  allowedMethods?: SignatureMethod[];
}

const DEFAULT_METHODS: SignatureMethod[] = ['DRAW', 'PIN', 'BIOMETRIC'];
const PAD_HEIGHT = 180;

interface Pt { x: number; y: number }
type Stroke = Pt[];

export function MobileSignatureInput(props: MobileSignatureInputProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const methods = props.allowedMethods ?? DEFAULT_METHODS;
  const [method, setMethod] = useState<SignatureMethod>(methods[0]);

  return (
    <View style={{ gap: 10 }}>
      {methods.length > 1 && (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {methods.map(m => (
            <Pressable
              key={m}
              onPress={() => setMethod(m)}
              style={[
                styles.tab,
                { borderColor: method === m ? colors.primary : colors.border,
                  backgroundColor: method === m ? colors.primary + '22' : 'transparent' },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: method === m }}
            >
              <Text style={{ color: method === m ? colors.primary : colors.text }}>
                {m === 'DRAW'      && t('driverBriefing.methodDraw')}
                {m === 'PIN'       && t('driverBriefing.methodPin')}
                {m === 'BIOMETRIC' && t('driverBriefing.methodBiometric')}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {method === 'DRAW'      && <DrawPad onChange={props.onChange} />}
      {method === 'PIN'       && <PinPad onChange={props.onChange} />}
      {method === 'BIOMETRIC' && <BiometricPad onChange={props.onChange} />}
    </View>
  );
}

// ─── DRAW — pan+svg ──────────────────────────────────────────────────────

function DrawPad({ onChange }: { onChange: (v: MobileSignatureValue) => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [width, setWidth]     = useState(0);
  const currentRef            = useRef<Stroke>([]);

  const responder: PanResponderInstance = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: (e: GestureResponderEvent) => {
      currentRef.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }];
      setStrokes(prev => [...prev, currentRef.current]);
    },
    onPanResponderMove: (e: GestureResponderEvent, g: PanResponderGestureState) => {
      const pt = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
      currentRef.current.push(pt);
      setStrokes(prev => [...prev.slice(0, -1), [...currentRef.current]]);
    },
    onPanResponderRelease: () => {
      // Build svg blob on release
      const svg = buildSvg(strokes.concat(currentRef.current.length > 1 ? [currentRef.current] : []), width, PAD_HEIGHT);
      onChange({ method: 'DRAW', blob: svg, isReady: strokes.length > 0 || currentRef.current.length > 1 });
      currentRef.current = [];
    },
  }), [strokes, width, onChange]);

  const clear = () => {
    setStrokes([]);
    currentRef.current = [];
    onChange({ method: 'DRAW', blob: '', isReady: false });
  };

  return (
    <View style={{ gap: 6 }}>
      <View
        onLayout={e => setWidth(e.nativeEvent.layout.width)}
        style={[styles.pad, { borderColor: colors.border, backgroundColor: colors.card }]}
        {...responder.panHandlers}
        accessibilityLabel="signature pad"
        accessibilityRole="image"
      >
        <Svg width="100%" height={PAD_HEIGHT}>
          {strokes.map((stroke, i) => (
            <Path
              key={i}
              d={strokeToPath(stroke)}
              stroke={colors.text}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
        {strokes.length === 0 && (
          <Text style={styles.padPlaceholder} pointerEvents="none">✍️</Text>
        )}
      </View>
      <Pressable onPress={clear}>
        <Text style={{ color: colors.text, fontSize: 12, textAlign: 'right' }}>
          {t('driverBriefing.clear')}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── PIN ─────────────────────────────────────────────────────────────────

function PinPad({ onChange }: { onChange: (v: MobileSignatureValue) => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [pin, setPin] = useState('');

  const handleChange = async (text: string) => {
    const clean = text.replace(/\D/g, '').slice(0, 8);
    setPin(clean);
    if (clean.length < 4) {
      onChange({ method: 'PIN', blob: '', isReady: false });
      return;
    }
    const blob = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, clean);
    onChange({ method: 'PIN', blob, isReady: true });
  };

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text, fontSize: 13 }}>{t('driverBriefing.pinLabel')}</Text>
      <TextInput
        value={pin}
        onChangeText={handleChange}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={8}
        accessibilityLabel="PIN signature"
        style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
      />
    </View>
  );
}

// ─── BIOMETRIC ───────────────────────────────────────────────────────────

function BiometricPad({ onChange }: { onChange: (v: MobileSignatureValue) => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [state, setState] = useState<'idle' | 'prompting' | 'ok' | 'err'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const trigger = async () => {
    setState('prompting'); setErr(null);
    try {
      const hasHw = await LocalAuth.hasHardwareAsync();
      const enrolled = await LocalAuth.isEnrolledAsync();
      if (!hasHw || !enrolled) {
        throw new Error(t('driverBriefing.biometricNotAvailable'));
      }
      const res = await LocalAuth.authenticateAsync({
        promptMessage: t('driverBriefing.biometricPrompt'),
        cancelLabel:   t('common.cancel'),
      });
      if (!res.success) throw new Error(res.error ?? 'cancelled');
      // Jeton opaque : timestamp authentifié. Le backend tenant peut
      // raffiner en liant à un device-id ou credential WebAuthn natif.
      const token = `bio-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setState('ok');
      onChange({ method: 'BIOMETRIC', blob: token, isReady: true });
    } catch (e) {
      setState('err');
      setErr(e instanceof Error ? e.message : String(e));
      onChange({ method: 'BIOMETRIC', blob: '', isReady: false });
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Pressable
        onPress={trigger}
        disabled={state === 'prompting'}
        style={[styles.btn, { backgroundColor: colors.primary }]}
      >
        <Text style={{ color: '#fff', fontWeight: '600' }}>
          {state === 'prompting'
            ? t('driverBriefing.biometricPrompting')
            : state === 'ok'
              ? t('driverBriefing.biometricOk')
              : t('driverBriefing.biometricTrigger')}
        </Text>
      </Pressable>
      {state === 'err' && err && (
        <Text style={{ color: '#dc2626', fontSize: 12 }}>{err}</Text>
      )}
    </View>
  );
}

// ─── SVG helpers ─────────────────────────────────────────────────────────

function strokeToPath(stroke: Stroke): string {
  if (stroke.length === 0) return '';
  const [first, ...rest] = stroke;
  return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ` +
         rest.map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

function buildSvg(strokes: Stroke[], width: number, height: number): string {
  const paths = strokes
    .map(s => `<path d="${strokeToPath(s)}" fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${paths}</svg>`;
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tab: {
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      6,
    borderWidth:       1,
  },
  pad: {
    height:       PAD_HEIGHT,
    borderWidth:  2,
    borderStyle:  'dashed',
    borderRadius: 8,
    overflow:     'hidden',
    position:     'relative',
  },
  padPlaceholder: {
    position:   'absolute',
    top:        '50%',
    left:       '50%',
    marginLeft: -12,
    marginTop:  -12,
    fontSize:   24,
  },
  input: {
    borderWidth:       1,
    borderRadius:      6,
    paddingHorizontal: 10,
    paddingVertical:   8,
    fontSize:          16,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical:   10,
    borderRadius:      6,
    alignItems:        'center',
  },
});
