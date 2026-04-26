/**
 * EmptyState — vue placeholder réutilisable quand une liste/section est vide.
 *
 * Usage :
 *   <EmptyState
 *     icon={IconClipboardList}
 *     title="Aucun trajet aujourd'hui"
 *     description="Pas de trajet planifié pour ce jour."
 *     action={{ label: 'Voir demain', onPress: () => setDate(tomorrow) }}
 *   />
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { type ComponentType } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { type IconProps } from './icons';

interface Props {
  icon?:        ComponentType<IconProps>;
  title:        string;
  description?: string;
  action?:      { label: string; onPress: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      {Icon && (
        <View style={[styles.iconWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Icon size={28} color={colors.textMuted} strokeWidth={1.5} />
        </View>
      )}
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {description && (
        <Text style={[styles.description, { color: colors.textMuted }]}>
          {description}
        </Text>
      )}
      {action && (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.action,
            { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={{ color: colors.primary, fontWeight: '700' }}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { padding: 32, alignItems: 'center', gap: 8 },
  iconWrap:    {
    width:           64,
    height:          64,
    borderRadius:    32,
    borderWidth:     1,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    8,
  },
  title:       { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  description: { fontSize: 13, textAlign: 'center', maxWidth: 280, lineHeight: 18 },
  action:      {
    marginTop:       12,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius:    999,
    borderWidth:     1,
    minHeight:       40,
    justifyContent:  'center',
  },
});
