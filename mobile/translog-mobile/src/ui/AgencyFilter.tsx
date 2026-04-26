/**
 * AgencyFilter — chips horizontales pour filtrer par agence.
 *
 * Auto-charge les agences du tenant courant via GET /api/tenants/:tid/agencies
 * et expose une callback onChange. Sentinel 'ALL' = pas de filtre (défaut).
 *
 * Usage :
 *   const [agencyId, setAgencyId] = useState<string | 'ALL'>('ALL');
 *   <AgencyFilter selected={agencyId} onChange={setAgencyId} />
 *   ...
 *   const url = agencyId === 'ALL' ? '/path' : `/path?agencyId=${agencyId}`;
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/useI18n';

interface Agency {
  id:   string;
  name: string;
}

interface Props {
  selected: string | 'ALL';
  onChange: (id: string | 'ALL') => void;
}

export function AgencyFilter({ selected, onChange }: Props) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { lang } = useI18n();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [agencies, setAgencies] = useState<Agency[]>([]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<Agency[]>(
        `/api/tenants/${tenantId}/agencies`,
        { skipAuthRedirect: true },
      );
      setAgencies(res ?? []);
    } catch {
      setAgencies([]);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  // 'ALL' en premier + agencies chargées
  const items: Agency[] = [
    { id: 'ALL', name: L('Toutes les agences', 'All agencies') },
    ...agencies,
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {items.map((a) => {
        const active = selected === a.id;
        return (
          <Pressable
            key={a.id}
            onPress={() => onChange(a.id as string | 'ALL')}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={a.name}
            style={[
              styles.chip,
              {
                borderColor:     active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary : 'transparent',
              },
            ]}
          >
            <Text style={{
              color:     active ? colors.primaryFg : colors.text,
              fontWeight:'600',
              fontSize:  12,
            }} numberOfLines={1}>
              {a.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row:  { paddingHorizontal: 16, paddingVertical: 8, gap: 8, flexDirection: 'row' },
  chip: {
    paddingVertical:   6,
    paddingHorizontal: 12,
    borderRadius:      999,
    borderWidth:       1,
    minHeight:         32,
    justifyContent:    'center',
    maxWidth:          200,
  },
});
