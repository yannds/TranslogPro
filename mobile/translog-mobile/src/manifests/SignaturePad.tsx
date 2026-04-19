/**
 * SignaturePad — canvas de signature tactile pur React Native + SVG.
 *
 * Pourquoi pas react-native-signature-canvas ?
 *   Cette lib embarque un WebView, alourdit le bundle, et nécessite un
 *   config plugin. Pour une signature simple (trait unique, noir),
 *   PanResponder + SVG suffisent largement et restent compatibles Expo Go.
 *
 * Contrat :
 *   - onChange(svg)  : re-émis à chaque point ajouté (léger debounce interne
 *                      optionnel côté consumer).
 *   - clear()        : exposé via ref — voir `useSignatureRef()`.
 *
 * Sécurité :
 *   - La signature ne contient que les coordonnées relatives au viewport —
 *     pas de donnée personnelle, pas d'EXIF. Base64 d'un SVG lisible.
 *   - L'aspect ratio est fixe : 16:9 → pas d'injection par dimensions hostiles.
 */

import { forwardRef, useImperativeHandle, useState, useRef } from 'react';
import { View, PanResponder, StyleSheet, type PanResponderGestureState, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Constantes UX — pas de magic number inline.
const STROKE_COLOR  = '#0f172a';
const STROKE_WIDTH  = 2;
const MIN_POINTS    = 3;

export interface SignaturePadRef {
  clear: () => void;
  toSvg: () => string | null;
  isEmpty: () => boolean;
}

export interface SignaturePadProps {
  /** Ratio largeur/hauteur — défaut 16/9 (format classique). */
  aspectRatio?: number;
  /** Couleur de fond (light mode friendly). Sinon blanc. */
  background?: string;
  onChange?: (hasInk: boolean) => void;
}

type Path2D = { d: string; points: number };

export const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(function SignaturePadImpl(
  { aspectRatio = 16 / 9, background = '#ffffff', onChange }, ref,
) {
  const [paths, setPaths] = useState<Path2D[]>([]);
  const activePath = useRef<string>('');
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useImperativeHandle(ref, () => ({
    clear: () => { setPaths([]); activePath.current = ''; onChange?.(false); },
    toSvg: () => {
      if (paths.length === 0) return null;
      const w = size.w || 320;
      const h = size.h || Math.round(320 / aspectRatio);
      const body = paths.map(p => `<path d="${p.d}" stroke="${STROKE_COLOR}" stroke-width="${STROKE_WIDTH}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`).join('');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
    },
    isEmpty: () => paths.length === 0,
  }));

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: (evt) => {
      const { x, y } = locate(evt);
      activePath.current = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    },
    onPanResponderMove: (evt, g: PanResponderGestureState) => {
      const { x, y } = locate(evt);
      activePath.current += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      // Re-render uniquement si l'utilisateur a bougé assez pour éviter le flood.
      if ((g.dx * g.dx + g.dy * g.dy) > 1) {
        setPaths(prev => {
          const rest = prev.slice(0, Math.max(0, prev.length - 1));
          return [...rest, { d: activePath.current, points: activePath.current.split(' ').length }];
        });
      }
    },
    onPanResponderRelease: () => {
      const count = activePath.current.split(' ').length;
      if (count < MIN_POINTS) {
        // Trop court pour être significatif → drop pour éviter un point parasite.
        setPaths(prev => prev.slice(0, Math.max(0, prev.length - 1)));
      } else {
        setPaths(prev => {
          const rest = prev.slice(0, Math.max(0, prev.length - 1));
          const merged = [...rest, { d: activePath.current, points: count }];
          onChange?.(merged.length > 0);
          return merged;
        });
      }
      activePath.current = '';
      // Commit de la path (nouvelle entrée pour le prochain trait)
      setPaths(prev => [...prev, { d: '', points: 0 }]);
    },
  })).current;

  function locate(evt: GestureResponderEvent): { x: number; y: number } {
    const { locationX, locationY } = evt.nativeEvent;
    return { x: locationX ?? 0, y: locationY ?? 0 };
  }

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Zone de signature"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[styles.pad, { aspectRatio, backgroundColor: background }]}
      {...responder.panHandlers}
    >
      {size.w > 0 && (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
          {paths.filter(p => p.points >= MIN_POINTS).map((p, i) => (
            <Path
              key={i}
              d={p.d}
              stroke={STROKE_COLOR}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </Svg>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  pad: {
    width:        '100%',
    borderWidth:  1,
    borderRadius: 8,
    borderColor:  '#cbd5e1',
  },
});
