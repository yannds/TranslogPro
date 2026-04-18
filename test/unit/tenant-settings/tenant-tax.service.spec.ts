import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantTaxService } from '../../../src/modules/tenant-settings/tenant-tax.service';

describe('TenantTaxService', () => {
  let svc: TenantTaxService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      tenantTax: {
        findMany:  jest.fn(),
        findFirst: jest.fn(),
        create:    jest.fn(),
        update:    jest.fn(),
        delete:    jest.fn(),
      },
    };
    svc = new TenantTaxService(prisma);
  });

  it('list retourne les taxes du tenant triées par sortOrder', async () => {
    prisma.tenantTax.findMany.mockResolvedValue([{ code: 'TVA' }]);
    const res = await svc.list('T1');
    expect(res).toEqual([{ code: 'TVA' }]);
    expect(prisma.tenantTax.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'T1' }, orderBy: { sortOrder: 'asc' },
    }));
  });

  it('create uppercase le code et applique les défauts', async () => {
    prisma.tenantTax.create.mockImplementation((args: any) => Promise.resolve(args.data));
    const res = await svc.create('T1', { code: 'tva', label: 'TVA 18%', rate: 0.18 });
    expect(res.code).toBe('TVA');
    expect(res.kind).toBe('PERCENT');
    expect(res.base).toBe('SUBTOTAL');
    expect(res.appliesTo).toEqual(['ALL']);
    expect(res.enabled).toBe(true);
  });

  it('create rejette rate négatif', async () => {
    await expect(svc.create('T1', { code: 'X', label: 'X', rate: -0.1 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('create rejette rate PERCENT > 1', async () => {
    await expect(svc.create('T1', { code: 'X', label: 'X', rate: 1.5, kind: 'PERCENT' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('create convertit P2002 Prisma en BadRequestException', async () => {
    prisma.tenantTax.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(svc.create('T1', { code: 'TVA', label: 'x', rate: 0.18 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('update rejette si inexistant', async () => {
    prisma.tenantTax.findFirst.mockResolvedValue(null);
    await expect(svc.update('T1', 'X', { rate: 0.2 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update n’envoie que les champs modifiés', async () => {
    prisma.tenantTax.findFirst.mockResolvedValue({ id: 'X', code: 'TVA', label: 'TVA', rate: 0.18, kind: 'PERCENT', base: 'SUBTOTAL' });
    prisma.tenantTax.update.mockResolvedValue({});
    await svc.update('T1', 'X', { rate: 0.2 });
    expect(prisma.tenantTax.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'X' },
      data:  { rate: 0.2 },
    }));
  });

  it('remove rejette si inexistant', async () => {
    prisma.tenantTax.findFirst.mockResolvedValue(null);
    await expect(svc.remove('T1', 'X')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove supprime la ligne', async () => {
    prisma.tenantTax.findFirst.mockResolvedValue({ id: 'X' });
    prisma.tenantTax.delete.mockResolvedValue({});
    const res = await svc.remove('T1', 'X');
    expect(res).toEqual({ ok: true });
    expect(prisma.tenantTax.delete).toHaveBeenCalledWith({ where: { id: 'X' } });
  });
});
