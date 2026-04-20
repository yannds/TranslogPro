/**
 * EtaTime — affichage "Prévu / Estimé" des heures de trajet.
 *
 * Convention métier (alignée IATA STA/ETA + SNCF "théorique/recalculé") :
 *   - **Prévu** : ce qui était inscrit dans le système au moment de la création
 *     du trajet (departureScheduled / arrivalScheduled DB).
 *   - **Estimé** : recalcul dynamique tenant compte du retard observé. Visible
 *     uniquement quand l'estimation diffère du prévu (sinon UI sobre).
 *
 * Le composant gère 2 layouts :
 *   - inline (par défaut) : "13:00" si OK, "13:00 → 23:25 +10h25" si retard.
 *   - stacked            : libellé "PRÉVU 13:00" + "ESTIMÉ 23:25" l'un sous
 *     l'autre — utile dans les cards où la lisibilité prime.
 *
 * Pas de useI18n direct : on accepte une prop `lang` pour la simplicité (les
 * écrans appellent déjà avec leur langue résolue) et pour pouvoir l'utiliser
 * dans des contextes hors hook (storybook, tests).
 */

import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface EtaTimeProps {
  /** ISO datetime ou null — heure prévue d'origine. */
  scheduled?: string | null;
  /** ISO datetime ou null — heure recalculée. Affichée si != prévue ET retard. */
  estimated?: string | null;
  /** Minutes de retard (>= 0). 0 = aucun retard, on affiche que prévu. */
  delayMinutes?: number;
  /** Layout : 'inline' (1 ligne avec flèche) ou 'stacked' (2 lignes labellisées). */
  layout?: 'inline' | 'stacked';
  /** 'fr' | 'en' — langue d'affichage. */
  lang?: 'fr' | 'en';
  /** Locale pour formatage horaire (par défaut langue). */
  locale?: string;
}

function formatHHMM(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format compact des minutes de retard : "+45 min" ou "+10h25".
 * Au-delà de 60 min on bascule en HH puis MM (lecture rapide pour les
 * écrans publics où il faut comprendre en 1 seconde).
 */
function formatDelay(minutes: number, lang: 'fr' | 'en'): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `+${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return lang === 'en'
    ? `+${h}h${String(rest).padStart(2, '0')}`
    : `+${h}h${String(rest).padStart(2, '0')}`;
}

export function EtaTime({
  scheduled, estimated, delayMinutes = 0, layout = 'inline', lang = 'fr', locale,
}: EtaTimeProps) {
  const { colors } = useTheme();
  const loc = locale ?? (lang === 'en' ? 'en-US' : 'fr-FR');

  const isLate = delayMinutes > 0 && !!estimated;
  const sched  = formatHHMM(scheduled, loc);
  const est    = formatHHMM(estimated, loc);
  const delay  = isLate ? formatDelay(delayMinutes, lang) : null;

  // L'orange = avertissement non-bloquant ; on évite le rouge réservé aux SOS.
  const lateColor = '#f59e0b';

  if (layout === 'stacked') {
    return (
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={[styles.label, { color: colors.textMuted }]}>
            {lang === 'en' ? 'SCHEDULED' : 'PRÉVU'}
          </Text>
          <Text style={[styles.value, { color: colors.text, textDecorationLine: isLate ? 'line-through' : 'none' }]}>
            {sched}
          </Text>
        </View>
        {isLate && (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={[styles.label, { color: lateColor }]}>
              {lang === 'en' ? 'ESTIMATED' : 'ESTIMÉ'}
            </Text>
            <Text style={[styles.value, { color: lateColor, fontWeight: '800' }]}>
              {est}
            </Text>
            <Text style={{ color: lateColor, fontSize: 11, fontWeight: '700' }}>
              {delay}
            </Text>
          </View>
        )}
      </View>
    );
  }

  // inline
  if (!isLate) {
    return <Text style={[styles.value, { color: colors.text }]}>{sched}</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
      <Text style={[styles.value, { color: colors.textMuted, textDecorationLine: 'line-through', fontSize: 12 }]}>
        {sched}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>→</Text>
      <Text style={[styles.value, { color: lateColor, fontWeight: '800' }]}>{est}</Text>
      <Text style={{ color: lateColor, fontSize: 11, fontWeight: '700' }}>{delay}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  value: { fontSize: 14, fontWeight: '600' },
});
