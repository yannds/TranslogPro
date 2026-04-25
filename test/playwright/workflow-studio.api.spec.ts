/**
 * E2E API test — Workflow studio (entity types + blueprints CRUD + graph reset).
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

test.describe('[E2E-API] Workflow studio', () => {

  test('[WFS-1] entity-types + blueprints CRUD', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const base = `/api/tenants/${tenantA.id}/workflow-studio`;

    // entity-types
    const types = await request.get(`${base}/entity-types`, { headers: authHeaders });
    expect(types.status(), `entity-types: ${await types.text()}`).toBe(200);
    expect(Array.isArray(await types.json())).toBe(true);

    // graph for Ticket (existing entity type seeded by ensureWorkflowConfigs)
    const graph = await request.get(`${base}/graph/Ticket`, { headers: authHeaders });
    expect(graph.status(), `graph: ${await graph.text()}`).toBe(200);

    // metadata
    const meta = await request.get(`${base}/graph/Ticket/metadata`, { headers: authHeaders });
    expect(meta.status()).toBe(200);

    // Create a blueprint with minimal valid graph
    const dto = {
      name:        `PW Blueprint ${Date.now()}`,
      slug:        `pw-${Date.now()}`,
      entityType:  'TestEntity',
      description: 'E2E',
      graph: {
        entityType: 'TestEntity',
        nodes: [
          { id: 'n1', label: 'INITIAL', type: 'initial' },
          { id: 'n2', label: 'DONE',    type: 'terminal' },
        ],
        edges: [
          {
            id: 'e1', source: 'n1', target: 'n2', label: 'finish',
            permission: 'data.test.write.tenant',
            guards: [], sideEffects: [],
          },
        ],
      },
    };

    const create = await request.post(`${base}/blueprints`, { headers: authHeaders, data: dto });
    expect(create.status(), `create bp: ${await create.text()}`).toBeLessThan(300);
    const bp = await create.json();
    expect(bp.id).toBeTruthy();

    // GET blueprint
    const get = await request.get(`${base}/blueprints/${bp.id}`, { headers: authHeaders });
    expect(get.status()).toBe(200);

    // List blueprints
    const list = await request.get(`${base}/blueprints`, { headers: authHeaders });
    expect(list.status()).toBe(200);

    // DELETE
    const del = await request.delete(`${base}/blueprints/${bp.id}`, { headers: authHeaders });
    expect(del.status(), `del: ${await del.text()}`).toBeLessThan(300);
  });
});
