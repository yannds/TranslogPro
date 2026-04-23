/**
 * GeoService — Tests unitaires
 *
 * Couvre :
 *   - sanitize : rejet q non-string, longueur min/max, strip control chars
 *   - cache HIT : pas d'appel fetch
 *   - cache MISS : appel Nominatim, normalisation, écriture cache
 *   - normalize : skip résultats invalides (lat/lng hors bornes, displayName vide)
 *   - upstream KO : ServiceUnavailable
 *
 * Mocks : ioredis Redis + global fetch.
 */
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GeoService } from '@modules/geo/geo.service';

type RedisMock = {
  get:   jest.Mock;
  setex: jest.Mock;
};

function makeRedis(getReturn: string | null = null): RedisMock {
  return {
    get:   jest.fn().mockResolvedValue(getReturn),
    setex: jest.fn().mockResolvedValue('OK'),
  };
}

function svc(redis: RedisMock): GeoService {
  return new GeoService(redis as never);
}

describe('GeoService.search', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.clearAllMocks(); });

  it('rejects non-string q', async () => {
    await expect(svc(makeRedis()).search(undefined as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects q shorter than 3 chars', async () => {
    await expect(svc(makeRedis()).search('ab'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects q longer than 120 chars', async () => {
    await expect(svc(makeRedis()).search('a'.repeat(121)))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns cached results without calling fetch', async () => {
    const cached = [{ displayName: 'Paris', lat: 48.85, lng: 2.35 }];
    const r = makeRedis(JSON.stringify(cached));
    global.fetch = jest.fn() as never;

    const out = await svc(r).search('Paris');

    expect(out).toEqual(cached);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls Nominatim on cache miss, normalizes and caches results', async () => {
    const r = makeRedis(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve([
        { display_name: 'Brazzaville, Congo', lat: '-4.2634', lon: '15.2429' },
        { display_name: '', lat: '0', lon: '0' },                    // skipped
        { display_name: 'Bad lat',  lat: '999', lon: '15' },         // skipped
        { display_name: 'Bad lng',  lat: '0',   lon: '999' },        // skipped
      ]),
    }) as never;

    const out = await svc(r).search('Brazzaville');

    // Le service expose désormais aussi countryCode (utile pour filtrage amont).
    expect(out).toEqual([{
      displayName: 'Brazzaville, Congo', lat: -4.2634, lng: 15.2429,
      countryCode: expect.any(String),
    }]);
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(call[0])).toContain('nominatim.openstreetmap.org/search');
    expect(call[1].headers['User-Agent']).toMatch(/TransLogPro/);
    expect(r.setex).toHaveBeenCalledWith(
      expect.stringMatching(/^geo:search:v2:[a-f0-9]+$/),
      3600,
      expect.any(String),
    );
  });

  it('strips control chars from query before sending', async () => {
    const r = makeRedis(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve([]),
    }) as never;

    await svc(r).search('Bra\x00zza\tville');

    const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url).toContain('Bra+zza+ville');
    expect(url).not.toContain('%00');
  });

  it('throws ServiceUnavailable on Nominatim non-2xx', async () => {
    const r = makeRedis(null);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;

    await expect(svc(r).search('Paris'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(r.setex).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailable on fetch network error', async () => {
    const r = makeRedis(null);
    global.fetch = jest.fn().mockRejectedValue(new Error('ENETUNREACH')) as never;

    await expect(svc(r).search('Paris'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
