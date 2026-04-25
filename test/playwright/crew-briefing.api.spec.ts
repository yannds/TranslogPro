/**
 * E2E API test — Crew briefing templates + items + safety alerts.
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

test.describe('[E2E-API] Crew briefing', () => {

  test('[CB-1] Equipment types CRUD', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA, ['CREW_BRIEFING']);
    const base = `/api/tenants/${tenantA.id}/crew-briefing`;

    const created = await (await request.post(`${base}/equipment-types`, {
      headers: authHeaders,
      data:    { name: 'Triangle', code: `TRI-${Date.now()}`, requiredQty: 1, isMandatory: true },
    })).json();
    expect(created.id).toBeTruthy();

    const list = await (await request.get(`${base}/equipment-types`, { headers: authHeaders })).json();
    expect(list.find((e: { id: string }) => e.id === created.id)).toBeTruthy();

    const upd = await request.patch(`${base}/equipment-types/${created.id}`, {
      headers: authHeaders, data: { name: 'Triangle renforcé' },
    });
    expect(upd.status(), `update equip: ${await upd.text()}`).toBeLessThan(300);
  });

  test('[CB-2] Templates → sections → items full flow', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA, ['CREW_BRIEFING']);
    const base = `/api/tenants/${tenantA.id}/crew-briefing`;

    // Template
    const tpl = await (await request.post(`${base}/templates`, {
      headers: authHeaders, data: { name: `PW Template ${Date.now()}`, description: 'E2E' },
    })).json();
    expect(tpl.id).toBeTruthy();

    // Section
    const sec = await (await request.post(`${base}/templates/${tpl.id}/sections`, {
      headers: authHeaders,
      data: { code: 'SAFETY', titleFr: 'Sécurité', titleEn: 'Safety', order: 1 },
    })).json();
    expect(sec.id).toBeTruthy();

    // Item
    const item = await (await request.post(`${base}/sections/${sec.id}/items`, {
      headers: authHeaders,
      data: { code: 'CHECK_TIRE', kind: 'CHECK', labelFr: 'Pneus OK', labelEn: 'Tires OK', isMandatory: true },
    })).json();
    expect(item.id).toBeTruthy();

    // Toggle item
    const toggle = await request.patch(`${base}/items/${item.id}/toggle`, { headers: authHeaders, data: { isActive: false } });
    expect(toggle.status(), `toggle: ${await toggle.text()}`).toBeLessThan(300);

    // Duplicate template
    const dup = await request.post(`${base}/templates/${tpl.id}/duplicate`, {
      headers: authHeaders, data: { newName: `${tpl.name} (copy)` },
    });
    expect(dup.status(), `duplicate: ${await dup.text()}`).toBeLessThan(300);

    // Delete item + section
    const di = await request.delete(`${base}/items/${item.id}`, { headers: authHeaders });
    expect(di.status(), `delete item: ${await di.text()}`).toBeLessThan(300);
    const ds = await request.delete(`${base}/sections/${sec.id}`, { headers: authHeaders });
    expect(ds.status(), `delete section: ${await ds.text()}`).toBeLessThan(300);
  });

  test('[CB-3] Safety alerts list (vide initialement)', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA, ['CREW_BRIEFING']);
    const base = `/api/tenants/${tenantA.id}/crew-briefing`;

    const list = await request.get(`${base}/safety-alerts`, { headers: authHeaders });
    expect(list.status(), `list: ${await list.text()}`).toBe(200);
    expect(Array.isArray(await list.json())).toBe(true);
  });
});
