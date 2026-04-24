/**
 * useNotifications — Stub pour écrans kiosk (BusScreen / QuaiScreen /
 * DepartureBoard) en attendant leur migration vers l'endpoint public.
 *
 * Le back-office (PageNotifications, AdminDashboard, PortalShell) utilise
 * `useAnnouncementFeed` qui tape l'endpoint authentifié tenant-scopé.
 *
 * TODO : brancher sur GET /api/public-portal/:slug/announcements
 * (endpoint public rate-limité, déjà exposé) + slug via resolveHost().
 */

import { useCallback, useState } from 'react';
import type { TranslationMap } from '../i18n/types';

export type NotificationType =
  | 'TRIP_STATUS_CHANGE'
  | 'WEATHER_UPDATE'
  | 'DELAY_ALERT'
  | 'SECURITY_ALERT'
  | 'TARIFF_CHANGE'
  | 'GENERAL_INFO'
  | 'ROAD_SAFETY';

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
  message:   TranslationMap;
  text?:     string;
  priority:  1 | 2 | 3;
  createdAt: Date;
  expiresAt?: Date;
  ref?:      string;
}

interface UseNotificationsOptions {
  tenantId:  string;
  maxItems?: number;
  endpoint?: string;
}

interface UseNotificationsResult {
  notifications: Notification[];
  isConnected:   boolean;
  latestByType:  (type: NotificationType) => Notification | undefined;
  dismiss:       (id: string) => void;
  clearAll:      () => void;
}

export function useNotifications(
  _opts: UseNotificationsOptions,
): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const latestByType = useCallback(
    (type: NotificationType) => notifications.find(n => n.type === type),
    [notifications],
  );

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  return {
    notifications,
    isConnected: false,
    latestByType,
    dismiss,
    clearAll,
  };
}
