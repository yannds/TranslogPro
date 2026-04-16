/**
 * QuaiAgentDashboard — Orchestrateur du portail Agent de Quai.
 */

import { PortalShell }      from '../portal/PortalShell';
import { QUAI_AGENT_NAV }   from '../../lib/navigation/nav.config';

export function QuaiAgentDashboard() {
  return (
    <PortalShell
      config={QUAI_AGENT_NAV}
      roleFallbackLabel="Agent de quai"
      ariaNavLabel="Navigation agent de quai"
    />
  );
}
