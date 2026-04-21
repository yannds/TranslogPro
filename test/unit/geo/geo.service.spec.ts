import { GeoService, COUNTRY_BBOX } from '../../../src/modules/geo/geo.service';

/**
 * Tests unitaires GeoService — biais pays via viewbox, pas d'exclusion internationale.
 *
 * fetch est mocké globalement : on inspecte les URLs construites et les résultats
 * normalisés sans aucune dépendance réseau ni Redis.
 */

const ABIDJAN_RESULT = {
  display_name: 'Abidjan, Lagunes, Côte d\'Ivoire',
  lat: '5.3600',
  lon: '-4.0083',
  address: { country_code: 'ci' },
};

const DAKAR_RESULT = {
  display_name: 'Dakar, Dakar, Sénégal',
  lat: '14.6928',
  lon: '-17.4467',
  address: { country_code: 'sn' },
};

function makeFetch(items: unknown[]) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(items),
  });
}

function makeService(fetchImpl: jest.Mock) {
  const redisMock = {
    get:   jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  };
  const svc = new GeoService(redisMock as any);
  (svc as any).fetch = fetchImpl; // override — see note in service
  return { svc, redisMock };
}

// Patch global fetch for the duration of each test
let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
  } as any));
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('GeoService.search — viewbox bias', () => {

  it('ajoute viewbox quand un countryCode connu est fourni (SN)', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([DAKAR_RESULT]) } as any);
    const redisMock = { get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue('OK') };
    const svc = new GeoService(redisMock as any);

    await svc.search('Dakar', 'SN');

    const calledUrl = decodeURIComponent(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl).toContain('viewbox=');
    const bbox = COUNTRY_BBOX['SN']!;
    expect(calledUrl).toContain(`viewbox=${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`);
    expect(calledUrl).not.toContain('bounded=1');
    expect(calledUrl).not.toContain('countrycodes=');
  });

  it("n'ajoute pas viewbox si le countryCode n'est pas dans le registre", async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) } as any);
    const redisMock = { get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue('OK') };
    const svc = new GeoService(redisMock as any);

    await svc.search('Lomé', 'XX');

    const calledUrl = (fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl).not.toContain('viewbox=');
  });

  it("n'ajoute pas viewbox si aucun countryCode n'est fourni", async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) } as any);
    const redisMock = { get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue('OK') };
    const svc = new GeoService(redisMock as any);

    await svc.search('Abidjan');

    const calledUrl = (fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl).not.toContain('viewbox=');
    expect(calledUrl).not.toContain('countrycodes=');
  });

  it('retourne Abidjan depuis un tenant SN — résultat hors-viewbox non bloqué', async () => {
    // Nominatim avec viewbox+bounded=0 peut renvoyer des résultats hors boîte
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([ABIDJAN_RESULT]) } as any);
    const redisMock = { get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue('OK') };
    const svc = new GeoService(redisMock as any);

    const results = await svc.search('Abidjan', 'SN');

    expect(results).toHaveLength(1);
    expect(results[0]!.displayName).toContain('Abidjan');
    expect(results[0]!.countryCode).toBe('CI');
  });

  it('utilise le cache Redis si disponible (pas de fetch)', async () => {
    const cached = [{ displayName: 'Brazzaville', lat: -4.26, lng: 15.24, countryCode: 'CG' }];
    const redisMock = {
      get:   jest.fn().mockResolvedValue(JSON.stringify(cached)),
      setex: jest.fn(),
    };
    const svc = new GeoService(redisMock as any);

    const results = await svc.search('Brazzaville', 'CG');

    expect(results).toEqual(cached);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clé de cache diffère selon le countryCode (pas de collision cross-tenant)', async () => {
    const redisMock = { get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue('OK') };
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) } as any);
    const svc = new GeoService(redisMock as any);

    await svc.search('Dakar', 'SN');
    await svc.search('Dakar', 'CG');

    const keys = (redisMock.get.mock.calls as [string][]).map(c => c[0]);
    expect(keys[0]).not.toEqual(keys[1]);
  });

  it('COUNTRY_BBOX couvre CG avec des coordonnées valides', () => {
    const bbox = COUNTRY_BBOX['CG']!;
    const [lngMin, latMax, lngMax, latMin] = bbox;
    expect(lngMin).toBeLessThan(lngMax);
    expect(latMin).toBeLessThan(latMax);
    // Brazzaville ~(-4.26, 15.24) doit être dans la boîte
    expect(15.24).toBeGreaterThan(lngMin);
    expect(15.24).toBeLessThan(lngMax);
    expect(-4.26).toBeGreaterThan(latMin);
    expect(-4.26).toBeLessThan(latMax);
  });
});
