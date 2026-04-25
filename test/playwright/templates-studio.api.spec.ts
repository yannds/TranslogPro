/**
 * E2E API test — Templates studio (CRUD complet documents PDF/HBS).
 *
 *   [TPL-1] GET /templates et /templates/system retournent des listes
 *   [TPL-2] POST /templates crée un template HBS
 *   [TPL-3] PUT /templates/:id met à jour le name
 *   [TPL-4] PATCH /templates/:id/set-default puis /unset-default
 *   [TPL-5] POST /templates/:id/duplicate clone un template
 *   [TPL-6] DELETE /templates/:id supprime un template tenant
 *   [TPL-7] PUT /templates/:id/schema (PDFME) persiste le JSON designer
 */
import { test, expect } from './fixtures';
import { setupAdminTenant } from './helpers/admin-setup';

const baseTpl = (data: Partial<{ name: string; slug: string }> = {}) => ({
  name:    data.name ?? 'PW Test Template',
  slug:    data.slug ?? `pw-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  docType: 'INVOICE',
  format:  'A4',
  engine:  'HBS',
  body:    '<html><body>{{tenant.name}}</body></html>',
});

test.describe('[E2E-API] Templates studio', () => {

  test('[TPL-1] GET /templates et /templates/system répondent', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);

    const tenantList = await request.get(`/api/tenants/${tenantA.id}/templates`, { headers: authHeaders });
    expect(tenantList.status(), `tenant list: ${await tenantList.text()}`).toBe(200);
    expect(Array.isArray(await tenantList.json())).toBe(true);

    const sysList = await request.get(`/api/tenants/${tenantA.id}/templates/system`, { headers: authHeaders });
    expect(sysList.status(), `system list: ${await sysList.text()}`).toBe(200);
    expect(Array.isArray(await sysList.json())).toBe(true);
  });

  test('[TPL-2] POST /templates crée un template HBS', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const dto = baseTpl();

    const res = await request.post(`/api/tenants/${tenantA.id}/templates`, {
      headers: authHeaders, data: dto,
    });
    expect(res.status(), `create: ${await res.text()}`).toBeLessThan(300);
    const tpl = await res.json();
    expect(tpl.id).toBeTruthy();
    expect(tpl.name).toBe(dto.name);
    expect(tpl.slug).toBe(dto.slug);
  });

  test('[TPL-3] PUT /templates/:id renomme un template', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const dto = baseTpl();
    const created = await (await request.post(`/api/tenants/${tenantA.id}/templates`, { headers: authHeaders, data: dto })).json();

    const newName = `${dto.name} (renamed)`;
    const res = await request.put(`/api/tenants/${tenantA.id}/templates/${created.id}`, {
      headers: authHeaders, data: { name: newName },
    });
    expect(res.status(), `update: ${await res.text()}`).toBeLessThan(300);
    const updated = await res.json();
    expect(updated.name).toBe(newName);
  });

  test('[TPL-4] set-default puis unset-default toggle isDefault', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const created = await (await request.post(`/api/tenants/${tenantA.id}/templates`, { headers: authHeaders, data: baseTpl() })).json();

    const r1 = await request.patch(`/api/tenants/${tenantA.id}/templates/${created.id}/set-default`, { headers: authHeaders });
    expect(r1.status(), `set-default: ${await r1.text()}`).toBeLessThan(300);
    expect((await r1.json()).isDefault).toBe(true);

    const r2 = await request.patch(`/api/tenants/${tenantA.id}/templates/${created.id}/unset-default`, { headers: authHeaders });
    expect(r2.status(), `unset-default: ${await r2.text()}`).toBeLessThan(300);
    expect((await r2.json()).isDefault).toBe(false);
  });

  test('[TPL-5] POST /templates/:id/duplicate clone', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const created = await (await request.post(`/api/tenants/${tenantA.id}/templates`, { headers: authHeaders, data: baseTpl() })).json();

    const res = await request.post(`/api/tenants/${tenantA.id}/templates/${created.id}/duplicate`, {
      headers: authHeaders, data: { name: 'PW Duplicate' },
    });
    expect(res.status(), `duplicate: ${await res.text()}`).toBeLessThan(300);
    const copy = await res.json();
    expect(copy.id).not.toBe(created.id);
    expect(copy.name).toBe('PW Duplicate');
  });

  test('[TPL-6] DELETE /templates/:id soft-delete (template absent de la liste tenant)', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const created = await (await request.post(`/api/tenants/${tenantA.id}/templates`, { headers: authHeaders, data: baseTpl() })).json();

    const res = await request.delete(`/api/tenants/${tenantA.id}/templates/${created.id}`, { headers: authHeaders });
    expect(res.status(), `delete: ${await res.text()}`).toBeLessThan(300);

    // Soft delete : template marqué isActive=false, ne doit plus apparaître dans la liste
    const list = await request.get(`/api/tenants/${tenantA.id}/templates`, { headers: authHeaders });
    expect(list.status()).toBe(200);
    const templates: { id: string }[] = await list.json();
    expect(templates.find(t => t.id === created.id)).toBeUndefined();
  });

  test('[TPL-7] PUT /templates/:id/schema persiste le PDFME JSON', async ({ request, tenantA }) => {
    const { authHeaders } = await setupAdminTenant(request, tenantA);
    const dto = { ...baseTpl(), engine: 'PDFME', body: undefined, schemaJson: { schemas: [[]], basePdf: '' } };
    const created = await (await request.post(`/api/tenants/${tenantA.id}/templates`, { headers: authHeaders, data: dto })).json();

    const newSchema = { schemas: [[{ name: 'title', type: 'text' }]], basePdf: '' };
    const res = await request.put(`/api/tenants/${tenantA.id}/templates/${created.id}/schema`, {
      headers: authHeaders, data: { schemaJson: newSchema },
    });
    expect(res.status(), `schema put: ${await res.text()}`).toBeLessThan(300);

    // Le PUT crée une NOUVELLE version (versioning immutable). On GET sur le nouvel id retourné.
    const next = await res.json();
    expect(next.id).not.toBe(created.id);
    expect(next.version).toBe(created.version + 1);

    const after = await request.get(`/api/tenants/${tenantA.id}/templates/${next.id}/schema`, { headers: authHeaders });
    expect(after.status()).toBe(200);
    const got = await after.json();
    expect(got.schemaJson?.schemas?.[0]?.[0]?.name).toBe('title');
    expect(got.engine).toBe('PDFME');
  });
});
