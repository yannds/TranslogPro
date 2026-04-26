/**
 * ScreenHeader — header standard pour tous les écrans nested (sub-screens).
 *
 * Usage :
 *   <ScreenHeader
 *     title="Trajets du jour"
 *     subtitle="42 trajets actifs"
 *     onBack={() => nav.goBack()}
 *     actions={[{ icon: IconRefresh, onPress: refresh, label: 'Refresh' }]}
 *   />
 *
 * Le bouton retour est optionnel : sur un tab principal, on n'en met pas.
 * Les actions sont des boutons icône à droite (max 3 raisonnable).
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { type ComponentType } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { IconBack, type IconProps } from './icons';

interface HeaderAction {
  icon:    ComponentType<IconProps>;
  onPress: () => void;
  label:   string; // accessibilityLabel
  badge?:  number;
}

interface Props {
  title:     string;
  subtitle?: string;
  onBack?:   () => void;
  actions?:  HeaderAction[];
}

export function ScreenHeader({ title, subtitle, onBack, actions = [] }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      {onBack && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={8}
          style={styles.backBtn}
        >
          <IconBack size={22} color={colors.text} />
        </Pressable>
      )}
      <View style={{ flex: 1, marginLeft: onBack ? 12 : 0 }}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {actions.length > 0 && (
        <View style={styles.actions}>
          {actions.map((a, i) => {
            const Icon = a.icon;
            return (
              <Pressable
                key={i}
                onPress={a.onPress}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                hitSlop={8}
                style={styles.actionBtn}
              >
                <Icon size={20} color={colors.text} />
                {typeof a.badge === 'number' && a.badge > 0 && (
                  <View style={[styles.badge, { backgroundColor: colors.danger }]}>
                    <Text style={styles.badgeText}>{a.badge > 99 ? '99+' : a.badge}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight:       56,
  },
  backBtn:   { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title:     { fontSize: 18, fontWeight: '700' },
  subtitle:  { fontSize: 12, marginTop: 1 },
  actions:   { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  badge:     {
    position:        'absolute',
    top:             4,
    right:           2,
    minWidth:        16,
    height:          16,
    borderRadius:    999,
    paddingHorizontal: 4,
    alignItems:      'center',
    justifyContent:  'center',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
