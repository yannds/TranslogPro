/**
 * SegmentedControl — contrôle à onglets horizontaux pour basculer entre vues
 * d'un même hub écran (utilisé par AdminOperations, AdminPlanning, AdminFinances,
 * StationService, DriverCabin, etc.).
 *
 * Usage :
 *   <SegmentedControl
 *     items={[
 *       { id: 'live',   label: 'En cours' },
 *       { id: 'trips',  label: 'Trajets', badge: 12 },
 *       { id: 'fleet',  label: 'Flotte'  },
 *     ]}
 *     selected={tab}
 *     onChange={setTab}
 *   />
 */

import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Item {
  id:     string;
  label:  string;
  badge?: number;
}

interface Props {
  items:    Item[];
  selected: string;
  onChange: (id: string) => void;
  /** Si true, scroll horizontal (utile pour 4+ onglets sur petit écran). */
  scrollable?: boolean;
}

export function SegmentedControl({ items, selected, onChange, scrollable = true }: Props) {
  const { colors } = useTheme();

  const Wrapper = scrollable ? ScrollView : View;
  const wrapperProps = scrollable
    ? { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: styles.row }
    : { style: styles.row };

  return (
    <Wrapper {...wrapperProps as any}>
      {items.map((it) => {
        const active = it.id === selected;
        return (
          <Pressable
            key={it.id}
            onPress={() => onChange(it.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={it.label}
            style={[
              styles.chip,
              {
                borderColor:     active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary : 'transparent',
              },
            ]}
          >
            <Text style={{
              color: active ? colors.primaryFg : colors.text,
              fontWeight: '600',
              fontSize: 13,
            }}>
              {it.label}
            </Text>
            {typeof it.badge === 'number' && it.badge > 0 && (
              <View style={[
                styles.badge,
                { backgroundColor: active ? colors.primaryFg : colors.danger },
              ]}>
                <Text style={[
                  styles.badgeText,
                  { color: active ? colors.primary : '#fff' },
                ]}>
                  {it.badge > 99 ? '99+' : it.badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  row:       { paddingHorizontal: 16, paddingVertical: 8, gap: 8, flexDirection: 'row' },
  chip:      {
    paddingVertical:   8,
    paddingHorizontal: 14,
    borderRadius:      999,
    borderWidth:       1,
    minHeight:         36,
    justifyContent:    'center',
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
  },
  badge:     {
    minWidth:        18,
    height:          18,
    borderRadius:    999,
    paddingHorizontal: 4,
    alignItems:      'center',
    justifyContent:  'center',
  },
  badgeText: { fontSize: 10, fontWeight: '800' },
});
