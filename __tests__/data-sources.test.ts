import { findNearbyShelters } from '../src/shelters';
import { lookupEvacuationZone } from '../src/zone';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, init: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
    ...init,
  } as unknown as Response;
}

const US_PLACE = { latitude: 27.9506, longitude: -82.4572, countryCode: 'US' as const };
const MX_PLACE = { latitude: 25.6866, longitude: -100.3161, countryCode: 'MX' as const };

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('findNearbyShelters', () => {
  it('reads US shelters from the FEMA directory and sorts by distance', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({
      features: [
        {
          id: 1,
          geometry: { type: 'Point', coordinates: [-82.4572, 27.9506] },
          properties: { shelter_name: 'Tampa Civic Center', address_1: '400 W Kennedy Blvd', city: 'Tampa', org_main_phone: '555-0100', wheelchair_accessible: 'Yes' },
        },
        {
          id: 2,
          geometry: { type: 'Point', coordinates: [-82.5000, 28.0000] },
          properties: { shelter_name: 'North Annex', address_1: '1 Anvil Rd', city: 'Tampa' },
        },
      ],
      exceededTransferLimit: false,
    })) as unknown as typeof fetch;

    const shelters = await findNearbyShelters(US_PLACE);

    expect(shelters).toHaveLength(2);
    expect(shelters[0].name).toBe('Tampa Civic Center');
    expect(shelters[0].address).toBe('400 W Kennedy Blvd');
    expect(shelters[0].phone).toBe('555-0100');
    expect(shelters[0].wheelchair).toBe('Yes');
    expect(shelters[0].distance).toBe(0);
    expect(shelters[1].distance).toBeGreaterThan(0);
  });

  it('keeps paging while the service reports more results', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        features: [{ id: 1, geometry: { type: 'Point', coordinates: [-82.4572, 27.9506] }, properties: { shelter_name: 'First' } }],
        exceededTransferLimit: true,
      }))
      .mockResolvedValueOnce(jsonResponse({
        features: [{ id: 2, geometry: { type: 'Point', coordinates: [-82.4600, 27.9600] }, properties: { shelter_name: 'Second' } }],
        exceededTransferLimit: false,
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const shelters = await findNearbyShelters(US_PLACE);

    expect(shelters.map(shelter => shelter.name)).toEqual(['First', 'Second']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toContain('resultOffset=1');
  });

  it('reports a calm error when the FEMA directory is unreachable', async () => {
    globalThis.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;

    const pending = findNearbyShelters(US_PLACE);
    const assertion = expect(pending).rejects.toThrow(/FEMA shelter directory is unavailable/);
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('reads Mexico shelters from community listings', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({
      elements: [
        { type: 'node', id: 7, lat: 25.69, lon: -100.31, tags: { name: 'Albergue Municipal', 'addr:street': 'Av. Constitución' } },
        { type: 'way', id: 8, center: { lat: 25.70, lon: -100.32 }, tags: { operator: 'DIF' } },
        { type: 'node', id: 9, tags: { name: 'No coordinates' } },
      ],
    })) as unknown as typeof fetch;

    const shelters = await findNearbyShelters(MX_PLACE);

    expect(shelters).toHaveLength(2);
    expect(shelters[0].name).toBe('Albergue Municipal');
    expect(shelters[0].address).toBe('Av. Constitución');
    expect(shelters[1].name).toBe('DIF');
  });

  it('reports a calm error when community listings are unreachable', async () => {
    globalThis.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;

    const pending = findNearbyShelters(MX_PLACE);
    const assertion = expect(pending).rejects.toThrow(/Community shelter listings are unavailable/);
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
  });
});

describe('lookupEvacuationZone', () => {
  it('returns the zone, county, and order status for a Florida point', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({
      features: [{ attributes: { EZone: ' Zone C ', County_Nam: ' Pinellas ', STATUS: ' Not in danger ' } }],
    })) as unknown as typeof fetch;

    await expect(lookupEvacuationZone(27.95, -82.45)).resolves.toEqual({
      zone: 'Zone C',
      county: 'Pinellas',
      status: 'Not in danger',
    });
  });

  it('returns null when the point is not inside a zone', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({ features: [{ attributes: { EZone: '  ' } }] })) as unknown as typeof fetch;
    await expect(lookupEvacuationZone(27.95, -82.45)).resolves.toBeNull();
  });

  it('surfaces a service error message', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({ error: { message: 'Layer not found' } })) as unknown as typeof fetch;
    await expect(lookupEvacuationZone(27.95, -82.45)).rejects.toThrow(/Layer not found/);
  });

  it('reports a calm error when the lookup is unreachable', async () => {
    globalThis.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;

    const pending = lookupEvacuationZone(27.95, -82.45);
    const assertion = expect(pending).rejects.toThrow(/Florida evacuation zone lookup is unavailable/);
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
  });
});
