import { GeoService } from '../../../src/modules/geo/geo.service';
import type { GeoProvider, GeoSearchResult } from '../../../src/modules/geo/providers/geo-provider.interface';

/**
 * Verifie l'orchestration multi-provider du GeoService :
 *  - Quand Google est configured et retourne des resultats : Google sert
 *  - Quand Google n'est pas configured : Mapbox prend le relais
 *  - Quand ni Google ni Mapbox : Nominatim sert (toujours configured)
 *  - Quand un provider retourne 0 resultat : on essaye le suivant
 *  - Quand un provider throw : on essaye le suivant
 *  - Cache Redis hit avant tout appel provider
 */
describe('GeoService — strategy multi-provider Google → Mapbox → Nominatim', () => {
  const mkRedis = (initial: Record<string, string> = {}) => {
    const store = { ...initial };
    return {
      get: jest.fn(async (k: string) => store[k] ?? null),
      setex: jest.fn(async (k: string, _ttl: number, v: string) => { store[k] = v; }),
    };
  };

  const mkProvider = (name: 'google' | 'mapbox' | 'nominatim', cfg: {
    isConfigured?: boolean;
    searchResults?: GeoSearchResult[] | Error;
    reverseResult?: GeoSearchResult | null | Error;
  } = {}): GeoProvider => ({
    name,
    isConfigured: jest.fn(async () => cfg.isConfigured ?? true),
    search: jest.fn(async () => {
      if (cfg.searchResults instanceof Error) throw cfg.searchResults;
      return cfg.searchResults ?? [];
    }),
    reverse: jest.fn(async () => {
      if (cfg.reverseResult instanceof Error) throw cfg.reverseResult;
      return cfg.reverseResult ?? null;
    }),
  });

  const mkSvc = (
    redis: any,
    google: GeoProvider,
    mapbox:  GeoProvider,
    nominatim: GeoProvider,
  ) => {
    const fakeSecret: any = { getSecret: jest.fn() };
    const svc: any = new GeoService(redis, fakeSecret);
    // Override les providers internes par nos mocks
    svc.google    = google;
    svc.mapbox    = mapbox;
    svc.nominatim = nominatim;
    return svc as GeoService;
  };

  const dummy = (lat: number, lng: number, displayName = 'X'): GeoSearchResult => ({
    displayName, lat, lng, countryCode: 'CG',
  });

  it('Cache hit Redis : aucun provider appele', async () => {
    const cached: GeoSearchResult[] = [dummy(4.2, 15.2, 'cached')];
    const redis = mkRedis();
    redis.get.mockResolvedValueOnce(JSON.stringify(cached));

    const google = mkProvider('google');
    const mapbox = mkProvider('mapbox');
    const nominatim = mkProvider('nominatim');
    const svc = mkSvc(redis, google, mapbox, nominatim);

    const out = await svc.search('Av Foch, Brazzaville', 'CG');
    expect(out).toEqual(cached);
    expect(google.search).not.toHaveBeenCalled();
    expect(mapbox.search).not.toHaveBeenCalled();
    expect(nominatim.search).not.toHaveBeenCalled();
  });

  it('Google configured + retourne 2 resultats : Google sert, Mapbox/Nominatim ignores', async () => {
    const redis = mkRedis();
    const google = mkProvider('google', {
      isConfigured: true,
      searchResults: [dummy(4.21, 15.31, 'g1'), dummy(4.22, 15.32, 'g2')],
    });
    const mapbox = mkProvider('mapbox');
    const nominatim = mkProvider('nominatim');
    const svc = mkSvc(redis, google, mapbox, nominatim);

    const out = await svc.search('Av Foch, Brazzaville', 'CG');
    expect(out).toHaveLength(2);
    expect(out[0].displayName).toBe('g1');
    expect(google.search).toHaveBeenCalledTimes(1);
    expect(mapbox.search).not.toHaveBeenCalled();
    expect(nominatim.search).not.toHaveBeenCalled();
  });

  it('Google not configured : Mapbox sert si configured', async () => {
    const redis = mkRedis();
    const google = mkProvider('google', { isConfigured: false });
    const mapbox = mkProvider('mapbox', {
      isConfigured: true,
      searchResults: [dummy(4.3, 15.4, 'mb1')],
    });
    const nominatim = mkProvider('nominatim');
    const svc = mkSvc(redis, google, mapbox, nominatim);

    const out = await svc.search('Av Foch, Brazzaville', 'CG');
    expect(out[0].displayName).toBe('mb1');
    expect(google.search).not.toHaveBeenCalled();
    expect(mapbox.search).toHaveBeenCalledTimes(1);
    expect(nominatim.search).not.toHaveBeenCalled();
  });

  it('Ni Google ni Mapbox configured : Nominatim sert (filet de derniere chance)', async () => {
    const redis = mkRedis();
    const google = mkProvider('google', { isConfigured: false });
    const mapbox = mkProvider('mapbox', { isConfigured: false });
    const nominatim = mkProvider('nominatim', {
      searchResults: [dummy(4.5, 15.5, 'osm1')],
    });
    const svc = mkSvc(redis, google, mapbox, nominatim);

    const out = await svc.search('Av Foch, Brazzaville', 'CG');
    expect(out[0].displayName).toBe('osm1');
    expect(nominatim.search).toHaveBeenCalledTimes(1);
  });

  it('Google retourne 0 resultat : fallback automatique sur Mapbox', async () => {
    const redis = mkRedis();
    const google = mkProvider('google', {
      isConfigured: true,
      searchResults: [], // 0 resultat
    });
    const mapbox = mkProvider('mapbox', {
      isConfigured: true,
      searchResults: [dummy(4.4, 15.5, 'mb-after-empty')],
    });
    const nominatim = mkProvider('nominatim');
    const svc = mkSvc(redis, google, mapbox, nominatim);

    const out = await svc.search('Adresse rare', 'CG');
    expect(out[0].displayName).toBe('mb-after-empty');
    expect(google.search).toHaveBeenCalledTimes(1);
    expect(mapbox.search).toHaveBeenCalledTimes(1);
  });

  it('Google throw : fallback automatique sur Mapbox sans bubble-up', async () => {
    const redis = mkRedis();
    const google = mkProvider('google', {
      isConfigured: true,
      searchResults: new Error('Google API quota exceeded'),
    });
    const mapbox = mkProvider('mapbox', {
      isConfigured: true,
      searchResults: [dummy(4.4, 15.5, 'mb-after-throw')],
    });
    const nominatim = mkProvider('nominatim');
    const svc = mkSvc(redis, google, mapbox, nominatim);

    const out = await svc.search('Av Foch, Brazzaville', 'CG');
    expect(out[0].displayName).toBe('mb-after-throw');
  });

  it('Tous les providers throw : ServiceUnavailableException remontee', async () => {
    const redis = mkRedis();
    const google = mkProvider('google', { isConfigured: true, searchResults: new Error('g') });
    const mapbox = mkProvider('mapbox', { isConfigured: true, searchResults: new Error('m') });
    const nominatim = mkProvider('nominatim', { searchResults: new Error('n') });
    const svc = mkSvc(redis, google, mapbox, nominatim);

    await expect(svc.search('xxxxxx', 'CG')).rejects.toThrow(/Geocoding indisponible/);
  });

  it('Tous retournent 0 resultat : tableau vide retourne (pas une erreur)', async () => {
    const redis = mkRedis();
    const google = mkProvider('google', { isConfigured: true, searchResults: [] });
    const mapbox = mkProvider('mapbox', { isConfigured: true, searchResults: [] });
    const nominatim = mkProvider('nominatim', { searchResults: [] });
    const svc = mkSvc(redis, google, mapbox, nominatim);

    const out = await svc.search('xxxxxx', 'CG');
    expect(out).toEqual([]);
  });

  it('Sanitize : query vide ou trop courte rejette en BadRequest', async () => {
    const redis = mkRedis();
    const svc = mkSvc(redis, mkProvider('google'), mkProvider('mapbox'), mkProvider('nominatim'));
    await expect(svc.search('ab', 'CG')).rejects.toThrow(/length/);
    await expect(svc.search('', 'CG')).rejects.toThrow(/length/);
    await expect(svc.search(null as any, 'CG')).rejects.toThrow(/string/);
  });

  it('Reverse : meme chaine — Google d abord, fallback si null/throw', async () => {
    const redis = mkRedis();
    const google = mkProvider('google', { isConfigured: true, reverseResult: null });
    const mapbox = mkProvider('mapbox', {
      isConfigured: true,
      reverseResult: dummy(4.4, 15.5, 'reverse-mb'),
    });
    const nominatim = mkProvider('nominatim');
    const svc = mkSvc(redis, google, mapbox, nominatim);

    const out = await svc.reverse(4.4, 15.5, 'CG');
    expect(out?.displayName).toBe('reverse-mb');
  });

  it('Reverse : coords hors plage rejette BadRequest', async () => {
    const redis = mkRedis();
    const svc = mkSvc(redis, mkProvider('google'), mkProvider('mapbox'), mkProvider('nominatim'));
    await expect(svc.reverse(100, 0)).rejects.toThrow(/range/);
    await expect(svc.reverse(0, 200)).rejects.toThrow(/range/);
    await expect(svc.reverse(NaN, 0)).rejects.toThrow(/finite/);
  });

  // ─── Selecteur de preference geo.provider ─────────────────────────────────

  const mkSvcWithPref = (
    pref: string | Error,
    google: GeoProvider,
    mapbox: GeoProvider,
    nominatim: GeoProvider,
  ) => {
    const redis = mkRedis();
    const fakeSecret: any = { getSecret: jest.fn() };
    const platformConfig: any = {
      getString: jest.fn(async () => {
        if (pref instanceof Error) throw pref;
        return pref;
      }),
    };
    const { GeoService } = require('../../../src/modules/geo/geo.service');
    const svc: any = new GeoService(redis, fakeSecret, platformConfig);
    svc.google = google;
    svc.mapbox = mapbox;
    svc.nominatim = nominatim;
    return svc;
  };

  it('PREF nominatim : ne tente JAMAIS Google ou Mapbox meme si configured', async () => {
    const google = mkProvider('google', { isConfigured: true, searchResults: [dummy(0, 0, 'g')] });
    const mapbox = mkProvider('mapbox', { isConfigured: true, searchResults: [dummy(0, 0, 'm')] });
    const nominatim = mkProvider('nominatim', { searchResults: [dummy(0, 0, 'n')] });
    const svc = mkSvcWithPref('nominatim', google, mapbox, nominatim);

    const out = await svc.search('xxxxx', 'CG');
    expect(out[0].displayName).toBe('n');
    expect(google.search).not.toHaveBeenCalled();
    expect(mapbox.search).not.toHaveBeenCalled();
  });

  it('PREF google : Google d abord, fallback Nominatim si echec, jamais Mapbox', async () => {
    const google = mkProvider('google', { isConfigured: true, searchResults: new Error('quota') });
    const mapbox = mkProvider('mapbox', { isConfigured: true, searchResults: [dummy(0, 0, 'm')] });
    const nominatim = mkProvider('nominatim', { searchResults: [dummy(0, 0, 'n-fallback')] });
    const svc = mkSvcWithPref('google', google, mapbox, nominatim);

    const out = await svc.search('xxxxx', 'CG');
    expect(out[0].displayName).toBe('n-fallback');
    expect(google.search).toHaveBeenCalled();
    expect(mapbox.search).not.toHaveBeenCalled();
  });

  it('PREF mapbox : Mapbox d abord, fallback Nominatim, jamais Google', async () => {
    const google = mkProvider('google', { isConfigured: true, searchResults: [dummy(0, 0, 'g')] });
    const mapbox = mkProvider('mapbox', { isConfigured: true, searchResults: [dummy(0, 0, 'mb')] });
    const nominatim = mkProvider('nominatim');
    const svc = mkSvcWithPref('mapbox', google, mapbox, nominatim);

    const out = await svc.search('xxxxx', 'CG');
    expect(out[0].displayName).toBe('mb');
    expect(google.search).not.toHaveBeenCalled();
  });

  it('PREF auto : chaine complete Google → Mapbox → Nominatim', async () => {
    const google = mkProvider('google', { isConfigured: false });
    const mapbox = mkProvider('mapbox', { isConfigured: true, searchResults: [dummy(0, 0, 'mb')] });
    const nominatim = mkProvider('nominatim');
    const svc = mkSvcWithPref('auto', google, mapbox, nominatim);

    const out = await svc.search('xxxxx', 'CG');
    expect(out[0].displayName).toBe('mb');
    expect(mapbox.search).toHaveBeenCalled();
  });

  it('PREF inconnue ou throw du PlatformConfig : tombe sur auto par defaut', async () => {
    const google = mkProvider('google', { isConfigured: false });
    const mapbox = mkProvider('mapbox', { isConfigured: false });
    const nominatim = mkProvider('nominatim', { searchResults: [dummy(0, 0, 'n')] });
    const svc = mkSvcWithPref(new Error('PlatformConfig DB down'), google, mapbox, nominatim);

    const out = await svc.search('xxxxx', 'CG');
    expect(out[0].displayName).toBe('n');
  });
});
