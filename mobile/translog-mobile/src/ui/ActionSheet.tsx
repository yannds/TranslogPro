/**
 * ActionSheet — feuille d'actions modale (cross-platform iOS/Android).
 *
 * RN n'a pas de composant ActionSheet natif portable simple. Alert.alert
 * supporte ≤3 boutons proprement sur Android. Pour 4+ actions, on utilise
 * notre propre Modal qui glisse depuis le bas.
 *
 * Usage :
 *   const [open, setOpen] = useState<Item | null>(null);
 *   ...
 *   <ActionSheet
 *     visible={!!open}
 *     onClose={() => setOpen(null)}
 *     title={open?.name}
 *     actions={[
 *       { label: 'Suspendre', icon: IconPower, destructive: true, onPress: () => suspend(open!) },
 *       { label: 'Reset password', icon: IconKey, onPress: () => reset(open!) },
 *     ]}
 *   />
 */

import { type ComponentType } from 'react';
import {
  View, Text, Pressable, Modal, StyleSheet,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { type IconProps } from './icons';

export interface ActionItem {
  label:        string;
  icon?:        ComponentType<IconProps>;
  /** Texte rouge si destructif. */
  destructive?: boolean;
  /** Optionnel : sous-texte sous le label (description). */
  description?: string;
  disabled?:    boolean;
  onPress:      () => void;
}

interface Props {
  visible:  boolean;
  onClose:  () => void;
  title?:   string;
  actions:  ActionItem[];
  /** Texte du bouton d'annulation (défaut "Annuler"). */
  cancelLabel?: string;
}

export function ActionSheet({ visible, onClose, title, actions, cancelLabel = 'Annuler' }: Props) {
  const { colors } = useTheme();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.background }]}>
          {title && (
            <Text style={[styles.title, { color: colors.textMuted }]} numberOfLines={1}>
              {title}
            </Text>
          )}
          {actions.map((a, i) => {
            const tone = a.destructive ? colors.danger : colors.text;
            const Icon = a.icon;
            return (
              <Pressable
                key={i}
                onPress={() => { onClose(); setTimeout(() => a.onPress(), 50); }}
                disabled={a.disabled}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                style={({ pressed }) => [
                  styles.action,
                  {
                    borderTopColor: colors.border,
                    opacity:        a.disabled ? 0.4 : pressed ? 0.6 : 1,
                  },
                ]}
              >
                {Icon && <Icon size={20} color={tone} />}
                <View style={{ flex: 1, marginLeft: Icon ? 12 : 0 }}>
                  <Text style={{ color: tone, fontWeight: '600', fontSize: 15 }}>
                    {a.label}
                  </Text>
                  {a.description && (
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                      {a.description}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cancel,
              { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={{ color: colors.textMuted, fontWeight: '700' }}>{cancelLabel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.7)', justifyContent: 'flex-end' },
  sheet:    { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 20 },
  title:    {
    fontSize:        12,
    fontWeight:      '700',
    letterSpacing:   0.6,
    textTransform:   'uppercase',
    paddingHorizontal: 20,
    paddingTop:        16,
    paddingBottom:     8,
  },
  action:   {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderTopWidth:  StyleSheet.hairlineWidth,
  },
  cancel:   {
    marginTop:       8,
    marginHorizontal: 12,
    paddingVertical: 12,
    borderRadius:    12,
    alignItems:      'center',
  },
});
