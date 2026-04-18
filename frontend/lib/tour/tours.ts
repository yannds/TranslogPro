/**
 * Registre central des tours disponibles.
 *
 * Convention : ajouter un `data-tour="<slug>"` sur les éléments cibles dans
 * chaque page. Le selector du step référence ce slug pour une cible stable
 * qui résiste aux renommages de classes Tailwind ou aux refactors internes.
 */
import type { TourStep } from '../../components/tour/ProductTour';

export const TICKETING_TOUR_ID = 'ticketing-v1';

export const TICKETING_TOUR_STEPS: TourStep[] = [
  {
    titleKey: 'tour.ticketing.intro.title',
    bodyKey:  'tour.ticketing.intro.body',
  },
  {
    selector: '[data-tour="trip-selector"]',
    titleKey: 'tour.ticketing.trip.title',
    bodyKey:  'tour.ticketing.trip.body',
  },
  {
    selector: '[data-tour="seat-map"]',
    titleKey: 'tour.ticketing.seat.title',
    bodyKey:  'tour.ticketing.seat.body',
  },
  {
    selector: '[data-tour="passengers-section"]',
    titleKey: 'tour.ticketing.passenger.title',
    bodyKey:  'tour.ticketing.passenger.body',
  },
  {
    selector: '[data-tour="station-selector"]',
    titleKey: 'tour.ticketing.stations.title',
    bodyKey:  'tour.ticketing.stations.body',
  },
  {
    selector: '[data-tour="discount-code"]',
    titleKey: 'tour.ticketing.promo.title',
    bodyKey:  'tour.ticketing.promo.body',
  },
  {
    selector: '[data-tour="payment-method"]',
    titleKey: 'tour.ticketing.payment.title',
    bodyKey:  'tour.ticketing.payment.body',
  },
  {
    selector: '[data-tour="confirm-btn"]',
    titleKey: 'tour.ticketing.confirm.title',
    bodyKey:  'tour.ticketing.confirm.body',
  },
];
