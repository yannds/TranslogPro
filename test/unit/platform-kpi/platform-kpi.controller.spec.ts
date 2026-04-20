import { PlatformKpiController } from '../../../src/modules/platform-kpi/platform-kpi.controller';

function makeService(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const base = {
    getNorthStar:        jest.fn().mockResolvedValue({}),
    getMrrBreakdown:     jest.fn().mockResolvedValue({}),
    getRetentionCohorts: jest.fn().mockResolvedValue({}),
    getTransactional:    jest.fn().mockResolvedValue({}),
    getAdoptionBreakdown: jest.fn().mockResolvedValue({}),
    getActivationFunnel: jest.fn().mockResolvedValue({}),
    getStrategic:        jest.fn().mockResolvedValue({}),
  };
  return { ...base, ...overrides } as any;
}

describe('PlatformKpiController — parameter parsing', () => {
  it('defaults days to 30 when not provided', async () => {
    const svc  = makeService();
    const ctrl = new PlatformKpiController(svc);
    await ctrl.northStar();
    expect(svc.getNorthStar).toHaveBeenCalledWith('compared', 30);
  });

  it('parses positive integer days', async () => {
    const svc  = makeService();
    const ctrl = new PlatformKpiController(svc);
    await ctrl.mrr('60');
    expect(svc.getMrrBreakdown).toHaveBeenCalledWith(60);
  });

  it('clamps days to ≤ 365', async () => {
    const svc  = makeService();
    const ctrl = new PlatformKpiController(svc);
    await ctrl.retention('10000');
    expect(svc.getRetentionCohorts).toHaveBeenCalledWith(365);
  });

  it('clamps days to ≥ 1 for zero or negative', async () => {
    const svc  = makeService();
    const ctrl = new PlatformKpiController(svc);
    await ctrl.transactional('0');
    expect(svc.getTransactional).toHaveBeenCalledWith(30); // fallback to default
    await ctrl.transactional('-5');
    expect(svc.getTransactional).toHaveBeenLastCalledWith(30);
  });

  it('falls back to default on invalid days string', async () => {
    const svc  = makeService();
    const ctrl = new PlatformKpiController(svc);
    await ctrl.strategic('abc');
    expect(svc.getStrategic).toHaveBeenCalledWith(7);
  });

  it('accepts all 3 north-star modes and falls back to compared', async () => {
    const svc  = makeService();
    const ctrl = new PlatformKpiController(svc);
    await ctrl.northStar('declarative');
    expect(svc.getNorthStar).toHaveBeenLastCalledWith('declarative', 30);
    await ctrl.northStar('heuristic');
    expect(svc.getNorthStar).toHaveBeenLastCalledWith('heuristic', 30);
    await ctrl.northStar('compared');
    expect(svc.getNorthStar).toHaveBeenLastCalledWith('compared', 30);
    await ctrl.northStar('invalid-mode' as any);
    expect(svc.getNorthStar).toHaveBeenLastCalledWith('compared', 30);
  });

  it('passes explicit days to getActivationFunnel (no days accepted, returns report)', async () => {
    const svc  = makeService();
    const ctrl = new PlatformKpiController(svc);
    await ctrl.activation();
    expect(svc.getActivationFunnel).toHaveBeenCalledTimes(1);
  });
});
