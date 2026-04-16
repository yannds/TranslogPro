/**
 * DriverDashboard — Orchestrateur du portail Chauffeur.
 *
 * Thin wrapper sur PortalShell — toute la logique UI est dans le shell
 * partagé. Si tu cherches comment la sidebar est rendue : `PortalShell`.
 */

import { PortalShell }   from '../portal/PortalShell';
import { DRIVER_NAV }    from '../../lib/navigation/nav.config';

export function DriverDashboard() {
  return (
    <PortalShell
      config={DRIVER_NAV}
      roleFallbackLabel="Chauffeur"
      ariaNavLabel="Navigation chauffeur"
    />
  );
}
