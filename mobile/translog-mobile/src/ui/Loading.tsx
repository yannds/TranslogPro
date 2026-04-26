/**
 * Loading — indicateur de chargement standard, centré.
 */

import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  /** Optionnel — texte sous le spinner. */
  hint?:    string;
  /** Hauteur de la zone (défaut auto, met "fill" pour prendre tout l'écran). */
  variant?: 'inline' | 'fill';
}

export function Loading({ hint, variant = 'inline' }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[
      styles.container,
      variant === 'fill' && styles.fill,
    ]}>
      <ActivityIndicator color={colors.primary} />
      {hint && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>{hint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, alignItems: 'center', justifyContent: 'center', gap: 8 },
  fill:      { flex: 1 },
  hint:      { fontSize: 12, marginTop: 4 },
});
