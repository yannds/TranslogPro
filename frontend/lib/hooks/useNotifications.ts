/**
 * useNotifications — Flux WebSocket de notifications en temps réel
 *
 * Se connecte au WebSocket du tenant et fournit :
 *   - messages[]  : liste des notifications actives
 *   - isConnected : état de la connexion
 *
 * Simule le comportement WebSocket en mode démo via un timer.
 * En production : remplacer MockWebSocket par le vrai Socket.io client.
 *
 * Types de notifications entrant depuis le serveur :
 *   TRIP_STATUS_CHANGE — changement de statut d'un trajet
 *   WEATHER_UPDATE     — mise à jour météo d'une ville
 *   DELAY_ALERT        — alerte retard (avec minutage)
 *   SECURITY_ALERT     — incident sécurité (route bloquée, accident)
 *   TARIFF_CHANGE      — changement tarifaire
 *   GENERAL_INFO       — annonce générale de la gare
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { TranslationMap } from '../i18n/types';

// ─── Types publics ────────────────────────────────────────────────────────────

export type NotificationType =
  | 'TRIP_STATUS_CHANGE'
  | 'WEATHER_UPDATE'
  | 'DELAY_ALERT'
  | 'SECURITY_ALERT'
  | 'TARIFF_CHANGE'
  | 'GENERAL_INFO'
  | 'ROAD_SAFETY';

/** Icône par type de notification (pour marquee/ticker) */
export const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  WEATHER_UPDATE:     '⛅',
  DELAY_ALERT:        '⏱',
  SECURITY_ALERT:     '⚠',
  ROAD_SAFETY:        '🛡',
  TARIFF_CHANGE:      '💰',
  TRIP_STATUS_CHANGE: '🚌',
  GENERAL_INFO:       'ℹ',
};

export interface Notification {
  id:        string;
  type:      NotificationType;
  /** Message multilingue — affiché selon langue active */
  message:   TranslationMap;
  /** Texte brut de fallback (si pas de TranslationMap) */
  text?:     string;
  priority:  1 | 2 | 3;          // 1 = urgent, 2 = info, 3 = banal
  createdAt: Date;
  expiresAt?: Date;
  /** Référence optionnelle (tripId, cityId…) */
  ref?:      string;
}

interface UseNotificationsOptions {
  tenantId:   string;
  maxItems?:  number;            // max notifications gardées en mémoire
  endpoint?:  string;            // URL WebSocket (optionnel en démo)
}

interface UseNotificationsResult {
  notifications: Notification[];
  isConnected:   boolean;
  latestByType:  (type: NotificationType) => Notification | undefined;
  dismiss:       (id: string) => void;
  clearAll:      () => void;
}

// ─── Données de démo ─────────────────────────────────────────────────────────

function makeDemoNotifications(): Notification[] {
  return [
    {
      id: 'n1', type: 'GENERAL_INFO', priority: 3, createdAt: new Date(),
      message: {
        fr:  'Bienvenue à la Gare Routière de Brazzaville. Bon voyage !',
        en:  'Welcome to Brazzaville Bus Terminal. Have a safe journey!',
        ln:  'Boyei malamu na Gare ya Brazzaville. Nzela malamu!',
        ktu: 'Boyei malamu na Gare ya Brazzaville. Nzela malamu!',
        es:  'Bienvenido a la Terminal de Brazzaville. ¡Buen viaje!',
        pt:  'Bem-vindo ao Terminal Rodoviário de Brazzaville. Boa viagem!',
        ar:  '!مرحبًا بكم في محطة براساڤيل. نتمنى لكم رحلة سعيدة',
        wo:  'Dalal jamm ci Gare bi Brazzaville. Dem ak jamm!',
      },
    },
    {
      id: 'n2', type: 'DELAY_ALERT', priority: 1, createdAt: new Date(),
      message: {
        fr:  'RETARD — Le départ 09:30 vers Pointe-Noire est retardé de 25 minutes suite à un contrôle technique.',
        en:  'DELAY — The 09:30 departure to Pointe-Noire is delayed by 25 minutes due to a technical check.',
        ln:  'ELƆKƆ — Bokei ya 09:30 na Pointe-Noire elɔkɔ ya minute 25 po na kobɔtela otobisi.',
        ktu: 'ELƆKƆ — Bakei ya 09:30 na Pointe-Noire elɔkɔ ya miniti 25.',
        es:  'RETRASO — La salida de las 09:30 a Pointe-Noire se retrasa 25 minutos por revisión técnica.',
        pt:  'ATRASO — A partida das 09:30 para Pointe-Noire está atrasada 25 minutos por inspeção técnica.',
        ar:  'تأخير — رحلة الساعة 9:30 إلى بوانت-نوار متأخرة 25 دقيقة بسبب فحص تقني.',
        wo:  'RËDD — Dem bi ci 09:30 ngir Pointe-Noire dafa rëdd 25 minit ci sàkku teknik.',
      },
    },
    {
      id: 'n3', type: 'WEATHER_UPDATE', priority: 3, createdAt: new Date(),
      message: {
        fr:  'MÉTÉO — Pointe-Noire : 28°C, partiellement nuageux, vent 15 km/h. Conditions routières normales.',
        en:  'WEATHER — Pointe-Noire: 28°C, partly cloudy, wind 15 km/h. Road conditions normal.',
        ln:  'BOZALISI — Pointe-Noire: 28°C, mopɛpɛ mwa, mopɛpɛ 15 km/h. Nzela ezali malamu.',
        ktu: 'BOZALISI — Pointe-Noire: 28°C, mapɛpɛ mwa. Nzela ezali malamu.',
        es:  'CLIMA — Pointe-Noire: 28°C, parcialmente nublado, viento 15 km/h. Carreteras normales.',
        pt:  'TEMPO — Pointe-Noire: 28°C, parcialmente nublado, vento 15 km/h. Condições rodoviárias normais.',
        ar:  'طقس — بوانت-نوار: 28°م، غائم جزئيًا، رياح 15 كم/ساعة. الطرق في حالة طبيعية.',
        wo:  'ÀDDINA — Pointe-Noire: 28°C, dëkk bu baax, fëjël 15 km/h. Yoon bi baax.',
      },
    },
    {
      id: 'n4', type: 'SECURITY_ALERT', priority: 2, createdAt: new Date(),
      message: {
        fr:  'ALERTE — RN1 km 145 : ralentissement signalé suite à des travaux routiers. Prévoir +30 min sur ce trajet.',
        en:  'ALERT — RN1 km 145: slowdown reported due to roadworks. Add 30 min to this route.',
        ln:  'LIKEBI — RN1 km 145: ntango molɔngɔ po na misala ya nzela. Bozanga minute 30 lisusu.',
        ktu: 'LIKEBI — RN1 km 145: ntango molɔngɔ po na misala ya nzela. Bozanga miniti 30.',
        es:  'ALERTA — RN1 km 145: ralentización por obras viales. Añadir 30 min a esta ruta.',
        pt:  'ALERTA — RN1 km 145: lentidão por obras rodoviárias. Acrescentar 30 min nesta rota.',
        ar:  'تنبيه — الطريق الوطني 1، كم 145: تباطؤ بسبب أعمال الطريق. أضف 30 دقيقة لهذا المسار.',
        wo:  'TÉGGIN — RN1 km 145: yoon bi ndëkk ci misala. Yokk 30 minit ci yoon bii.',
      },
    },
    {
      id: 'n5', type: 'TARIFF_CHANGE', priority: 2, createdAt: new Date(),
      message: {
        fr:  'INFO TARIF — À compter du 15/04/2026, le prix Brazzaville–Pointe-Noire passe à 8 500 FCFA.',
        en:  'FARE INFO — From 15/04/2026, the Brazzaville–Pointe-Noire fare increases to 8,500 FCFA.',
        ln:  'SANGO YA PRIX — Banda 15/04/2026, prix ya Brazzaville–Pointe-Noire ekomi 8 500 FCFA.',
        ktu: 'SANGO YA PRIX — Banda 15/04/2026, prix ya Brazzaville–Pointe-Noire ekomi 8 500 FCFA.',
        es:  'INFO TARIFA — Desde el 15/04/2026, la tarifa Brazzaville–Pointe-Noire sube a 8.500 FCFA.',
        pt:  'INFO TARIFA — A partir de 15/04/2026, a tarifa Brazzaville–Pointe-Noire passa para 8.500 FCFA.',
        ar:  'معلومات التعرفة — اعتبارًا من 15/04/2026، ترتفع تعريفة براساڤيل–بوانت-نوار إلى 8.500 فرنك.',
        wo:  'XIBAAR CI PRIX — Ci 15/04/2026, jëg Brazzaville–Pointe-Noire dafa yokk ngir 8 500 FCFA.',
      },
    },

    // ── Météo détaillée ───────────────────────────────────────────────────────
    {
      id: 'n6', type: 'WEATHER_UPDATE', priority: 3, createdAt: new Date(),
      message: {
        fr:  'Brazzaville : ☀ 27°C, humidité 78%, vent 12 km/h — Bonne visibilité',
        en:  'Brazzaville: ☀ 27°C, humidity 78%, wind 12 km/h — Good visibility',
        ln:  'Brazzaville: ☀ 27°C, mái 78%, mopɛpɛ 12 km/h — Komona malamu',
        ktu: 'Brazzaville: ☀ 27°C, mái 78%, mopɛpɛ 12 km/h — Komona malamu',
        es:  'Brazzaville: ☀ 27°C, humedad 78%, viento 12 km/h — Buena visibilidad',
        pt:  'Brazzaville: ☀ 27°C, umidade 78%, vento 12 km/h — Boa visibilidade',
        ar:  'برازافيل: ☀ 27°م، رطوبة 78%، رياح 12 كم/ساعة — رؤية جيدة',
        wo:  'Brazzaville: ☀ 27°C, ndox ci kanam 78%, fëjël 12 km/h — Gis bu baax',
      },
    },
    {
      id: 'n7', type: 'WEATHER_UPDATE', priority: 2, createdAt: new Date(),
      message: {
        fr:  'Dolisie : 🌧 24°C, pluie modérée attendue — Prudence sur la RN1',
        en:  'Dolisie: 🌧 24°C, moderate rain expected — Caution on RN1',
        ln:  'Dolisie: 🌧 24°C, mbula mwa ekoya — Bokeba na nzela RN1',
        ktu: 'Dolisie: 🌧 24°C, mvula mwa ekoya — Bokeba na nzela RN1',
        es:  'Dolisie: 🌧 24°C, lluvia moderada prevista — Precaución en la RN1',
        pt:  'Dolisie: 🌧 24°C, chuva moderada prevista — Cautela na RN1',
        ar:  'دوليزي: 🌧 24°م، أمطار معتدلة متوقعة — الحذر على الطريق الوطني 1',
        wo:  'Dolisie: 🌧 24°C, taw bu yàgg dafay ñëw — Wóor ci yoon RN1',
      },
    },
    {
      id: 'n8', type: 'WEATHER_UPDATE', priority: 3, createdAt: new Date(),
      message: {
        fr:  'Ouesso : ☁ 26°C, ciel couvert, humidité 90% — Route praticable',
        en:  'Ouesso: ☁ 26°C, overcast, humidity 90% — Road passable',
        ln:  'Ouesso: ☁ 26°C, likoló etondi, mái 90% — Nzela esengeli',
        ktu: 'Ouesso: ☁ 26°C, likoló etondi, mái 90% — Nzela esengeli',
        es:  'Ouesso: ☁ 26°C, cielo cubierto, humedad 90% — Carretera transitable',
        pt:  'Ouesso: ☁ 26°C, céu encoberto, umidade 90% — Estrada transitável',
        ar:  'أويسو: ☁ 26°م، سماء ملبدة، رطوبة 90% — الطريق سالك',
        wo:  'Ouesso: ☁ 26°C, asamaan bu ñuul, ndox ci kanam 90% — Yoon bi ngi jëm',
      },
    },

    // ── Sécurité routière ─────────────────────────────────────────────────────
    {
      id: 'n9', type: 'ROAD_SAFETY', priority: 1, createdAt: new Date(),
      message: {
        fr:  'Le port de la ceinture de sécurité est obligatoire pour tous les passagers durant tout le trajet',
        en:  'Wearing a seatbelt is mandatory for all passengers throughout the entire journey',
        ln:  'Kolata singilé ya sécurité esengeli po na bato nyonso na mobembo mobimba',
        ktu: 'Kolata singilé ya sécurité esengeli po na bato nyonso na mobembo mobimba',
        es:  'El uso del cinturón de seguridad es obligatorio para todos los pasajeros durante todo el trayecto',
        pt:  'O uso do cinto de segurança é obrigatório para todos os passageiros durante toda a viagem',
        ar:  'ارتداء حزام الأمان إلزامي لجميع الركاب طوال الرحلة',
        wo:  'Tàcc ceinture de sécurité dafay wàjib ngir kilifa yépp ci yoon bi yépp',
      },
    },
    {
      id: 'n10', type: 'ROAD_SAFETY', priority: 2, createdAt: new Date(),
      message: {
        fr:  'Restez assis pendant le trajet. Ne vous levez pas lorsque le véhicule est en mouvement',
        en:  'Stay seated during the trip. Do not stand up while the vehicle is in motion',
        ln:  'Tóngalá na esíka ya bino na mobembo mobimba. Botéláma tɛ́ soki otobisi ezali kotámbola',
        ktu: 'Tóngalá na esíka na mobembo mobimba. Botéláma tɛ́ soki otobisi ezali kotámbola',
        es:  'Permanezca sentado durante el viaje. No se levante mientras el vehículo está en movimiento',
        pt:  'Permaneça sentado durante a viagem. Não se levante enquanto o veículo estiver em movimento',
        ar:  'ابقَ جالسًا خلال الرحلة. لا تقم بالوقوف أثناء تحرك المركبة',
        wo:  'Toogal ci sa palaas ci yoon bi. Bul taxaw bu otobisi di daw',
      },
    },
    {
      id: 'n11', type: 'ROAD_SAFETY', priority: 2, createdAt: new Date(),
      message: {
        fr:  'En cas d\'urgence, les issues de secours sont situées aux fenêtres latérales et à l\'arrière du véhicule',
        en:  'In case of emergency, emergency exits are located at the side windows and rear of the vehicle',
        ln:  'Soki likama, ba porte ya kobima ya noki ezali na ba fenêtre ya mipángi mpe na sima ya otobisi',
        ktu: 'Soki likama, ba porte ya kobima ezali na ba fenêtre ya mipángi mpe na sima ya otobisi',
        es:  'En caso de emergencia, las salidas están en las ventanas laterales y en la parte trasera del vehículo',
        pt:  'Em caso de emergência, as saídas estão nas janelas laterais e na traseira do veículo',
        ar:  'في حالة الطوارئ، مخارج الطوارئ تقع عند النوافذ الجانبية ومؤخرة المركبة',
        wo:  'Ci jafe-jafe, barab yi ñu génne ci palaas yi nekk ci palanteer yi ak ginnaaw otobisi bi',
      },
    },
    {
      id: 'n12', type: 'ROAD_SAFETY', priority: 3, createdAt: new Date(),
      message: {
        fr:  'Il est interdit de fumer à bord du véhicule. Merci de respecter le confort de tous les voyageurs',
        en:  'Smoking is prohibited on board. Please respect the comfort of all passengers',
        ln:  'Komɛla likaya na kati ya otobisi epekisami. Tiká bókómisa bato nyonso báselá malamu',
        ktu: 'Komɛla likaya na kati ya otobisi epekisami. Tiká bókómisa bato nyonso báselá malamu',
        es:  'Está prohibido fumar a bordo del vehículo. Respete la comodidad de todos los viajeros',
        pt:  'É proibido fumar a bordo do veículo. Respeite o conforto de todos os passageiros',
        ar:  'يُمنع التدخين على متن المركبة. يرجى احترام راحة جميع المسافرين',
        wo:  'Tuxu dafay tere ci biir otobisi bi. Jëflal hormaal kilifa yépp',
      },
    },
    {
      id: 'n13', type: 'ROAD_SAFETY', priority: 2, createdAt: new Date(),
      message: {
        fr:  'Surveillez vos effets personnels et bagages. La compagnie décline toute responsabilité en cas de perte',
        en:  'Watch your personal belongings and luggage. The company is not liable for any loss',
        ln:  'Bókɛngɛla biloko na bino malamu. Compagnie ezali na ngámbo tɛ́ soki biloko ebungi',
        ktu: 'Bókɛngɛla biloko na bino malamu. Compagnie ezali na ngámbo tɛ́ soki biloko ebungi',
        es:  'Vigile sus pertenencias y equipaje. La empresa no se hace responsable en caso de pérdida',
        pt:  'Cuide dos seus pertences e bagagem. A empresa não se responsabiliza por perdas',
        ar:  'راقب أمتعتك الشخصية. الشركة غير مسؤولة عن أي فقدان',
        wo:  'Saytul sa yéf ak sa walis. Borom otobisi du am njuumte ci lenn gu ñaari',
      },
    },
  ];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications({
  tenantId,
  maxItems = 50,
  endpoint,
}: UseNotificationsOptions): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>(() =>
    makeDemoNotifications(),
  );
  const [isConnected, setIsConnected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // En production, ici Socket.io :
    // const socket = io(endpoint, { query: { tenantId } });
    // socket.on('notification', (n: Notification) => { ... });
    // Pour l'instant : simulation de connexion + nouveaux messages toutes les 30s
    setIsConnected(true);

    timerRef.current = setInterval(() => {
      // Simule une nouvelle notification en temps réel
      const rotatingMsg: Notification = {
        id: `live-${Date.now()}`,
        type: 'GENERAL_INFO',
        priority: 3,
        createdAt: new Date(),
        message: {
          fr:  `Mise à jour ${new Date().toLocaleTimeString('fr-FR')} — Tous les services opérationnels.`,
          en:  `Update ${new Date().toLocaleTimeString('en-GB')} — All services operational.`,
          ln:  `Ebongwaki ${new Date().toLocaleTimeString('fr-FR')} — Misala nyonso esali malamu.`,
          ktu: `Ebongwaki ${new Date().toLocaleTimeString('fr-FR')} — Misala nyonso esali malamu.`,
          es:  `Actualización ${new Date().toLocaleTimeString('es-ES')} — Todos los servicios operativos.`,
          pt:  `Atualização ${new Date().toLocaleTimeString('pt-PT')} — Todos os serviços operacionais.`,
          ar:  `تحديث ${new Date().toLocaleTimeString('ar-SA')} — جميع الخدمات تعمل بشكل طبيعي.`,
          wo:  `Yeesal ${new Date().toLocaleTimeString('fr-FR')} — Yépp dafay liggeey.`,
        },
      };
      setNotifications(prev => [rotatingMsg, ...prev].slice(0, maxItems));
    }, 30_000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      setIsConnected(false);
    };
  }, [tenantId, endpoint, maxItems]);

  const latestByType = useCallback(
    (type: NotificationType) =>
      notifications.find(n => n.type === type),
    [notifications],
  );

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  return { notifications, isConnected, latestByType, dismiss, clearAll };
}
