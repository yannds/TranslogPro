/**
 * PlaceholderScreen — Vue temporaire pour les écrans driver en cours de
 * livraison (Sprints D2 → D6). Affiche un message explicite + bouton retour.
 *
 * À supprimer une fois tous les écrans Driver remplacés par leur impl réelle.
 */

import { View, Text, SafeAreaView, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  screenTitle: string;
  description: string;
}

export function makePlaceholder({ screenTitle, description }: Props) {
  return function PlaceholderScreen() {
    const { colors } = useTheme();
    const navigation = useNavigation<NavigationProp<any>>();
    const route      = useRoute();
    const params     = (route.params ?? {}) as Record<string, unknown>;

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ padding: 24, gap: 12 }}>
          <Pressable onPress={() => navigation.goBack()} style={styles.back}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>‹ Retour</Text>
          </Pressable>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{screenTitle}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>{description}</Text>
          {Object.keys(params).length > 0 && (
            <View style={{ marginTop: 12, padding: 12, backgroundColor: colors.surface, borderRadius: 8 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 4 }}>Contexte reçu :</Text>
              <Text style={{ color: colors.text, fontSize: 12, fontFamily: 'Menlo' }}>
                {JSON.stringify(params, null, 2)}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  };
}

const styles = StyleSheet.create({
  back: { width: 60, minHeight: 44, justifyContent: 'center' },
});
