/**
 * StationAgentDashboard — Orchestrateur du portail Agent de Gare.
 */

import { PortalShell }          from '../portal/PortalShell';
import { STATION_AGENT_NAV }    from '../../lib/navigation/nav.config';

export function StationAgentDashboard() {
  return (
    <PortalShell
      config={STATION_AGENT_NAV}
      roleFallbackLabel="Agent de gare"
      ariaNavLabel="Navigation agent de gare"
    />
  );
}
