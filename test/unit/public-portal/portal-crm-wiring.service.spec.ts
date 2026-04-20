// Mock modules ESM (pdfme) avant l'import du service qui dépend transitivement
// de DocumentsService → PdfmeService → @pdfme/*.
jest.mock('@pdfme/generator',        () => ({ generate: jest.fn() }),        { virtual: true });
jest.mock('@pdfme/common',           () => ({}),                              { virtual: true });
jest.mock('@pdfme/schemas',          () => ({ text: {}, image: {}, barcodes: {}, rectangle: {}, line: {}, ellipse: {}, table: {} }), { virtual: true });

import { PublicPortalService } from '../../../src/modules/public-portal/public-portal.service';

/**
 * Tests unitaires — câblage CRM dans le portail public (2026-04-20).
 *
 * Vérifie que les flows publics créent bien des Customer "shadow" via
 * CustomerResolverService (contrat CRM canonique, cf. CLAUDE.md) :
 *   - createBooking : resolver appelé par passager, customerId propagé au ticket
 *   - createParcelPickupRequest : resolver appelé pour sender + recipient
 *   - bumpCounters appelé dans la transaction
 *   - issueToken / recomputeSegmentsFor appelés post-transaction
 *   - Sentinel 'portal-anonymous' éliminé (passengerId/senderId = null)
 */
describe('PublicPortalService — câblage CRM portail', () => {
  const tenantId = 'tenant-a';

  const buildTenant = () => ({
    id: tenantId, name: 'Tenant A', slug: 'tenant-a',
    country: 'CG', language: 'fr', currency: 'XAF', timezone: 'Africa/Brazzaville',
    city: 'Brazzaville', isActive: true, provisionStatus: 'ACTIVE',
  });

  const buildTrip = () => ({
    id: 'trip-1',
    status: 'OPEN',
    departureScheduled: new Date(Date.now() + 4 * 3600_000),
    arrivalScheduled:   new Date(Date.now() + 12 * 3600_000),
    seatingMode: 'FREE',
    tenantId,
    route: {
      id:            'route-1',
      name:          'Brazza → PNR',
      originId:      'st-brz',
      destinationId: 'st-pnr',
      basePrice:     15_000,
      distanceKm:    500,
      allowProportionalFallback: true,
      origin:        { id: 'st-brz', name: 'Gare Brazzaville', city: 'Brazzaville' },
      destination:   { id: 'st-pnr', name: 'Gare Pointe-Noire', city: 'Pointe-Noire' },
      waypoints:     [],
      segmentPrices: [],
    },
    bus: {
      capacity: 50, seatLayout: null, isFullVip: false, vipSeats: [],
    },
  });

  function buildService(mocks: {
    resolveOrCreate: jest.Mock;
    bumpCounters:    jest.Mock;
    issueToken:      jest.Mock;
    recomputeSegmentsFor: jest.Mock;
    prismaOverrides?: Record<string, any>;
  }) {
    const prismaMock: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue(buildTenant()),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue(buildTrip()),
      },
      agency: {
        findFirst: jest.fn().mockResolvedValue({ id: 'agency-1' }),
      },
      tenantBusinessConfig: {
        findUnique: jest.fn().mockResolvedValue({
          seatSelectionFee: 0,
          intermediateBookingEnabled: true,
          intermediateBookingCutoffMins: 30,
          intermediateSegmentBlacklist: [],
        }),
      },
      station: {
        findFirst: jest.fn().mockResolvedValue({ id: 'st-pnr', name: 'Pointe-Noire', city: 'Pointe-Noire' }),
      },
      ticket: {
        update: jest.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
      },
      // Transaction exécute la callback avec un tx mock
      transact: jest.fn(async (fn: any) => {
        const tx: any = {
          ticket: {
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockImplementation(async ({ data }) => ({
              id: data.id ?? 'ticket-' + Math.random().toString(36).slice(2, 8),
              ...data,
            })),
          },
          parcel: {
            create: jest.fn().mockImplementation(async ({ data }) => ({
              id: data.id ?? 'parcel-1',
              ...data,
            })),
          },
          customer: { update: jest.fn() },
        };
        const result = await fn(tx);
        (prismaMock as any).__lastTx = tx;
        return result;
      }),
      ...(mocks.prismaOverrides ?? {}),
    };

    const redisMock = {
      get:   jest.fn().mockResolvedValue(null),
      set:   jest.fn().mockResolvedValue('OK'),
      setex: jest.fn().mockResolvedValue('OK'),
    };

    const qrMock = { sign: jest.fn().mockResolvedValue('qr-token') };
    const documentsMock = {
      printTicketStub:   jest.fn().mockResolvedValue({ downloadUrl: null }),
      printInvoicePro:   jest.fn().mockResolvedValue({ downloadUrl: null }),
      printParcelLabel:  jest.fn().mockResolvedValue({ downloadUrl: null }),
    };
    const eventBusMock = { publish: jest.fn().mockResolvedValue(undefined) };
    const notificationMock = { sendWithChannelFallback: jest.fn().mockResolvedValue(undefined) };

    const crmResolverMock: any = {
      resolveOrCreate:     mocks.resolveOrCreate,
      bumpCounters:        mocks.bumpCounters,
      recomputeSegmentsFor: mocks.recomputeSegmentsFor,
    };
    const crmClaimMock: any = { issueToken: mocks.issueToken };

    const service = new PublicPortalService(
      prismaMock,
      {} as any, // brand
      qrMock as any,
      documentsMock as any,
      {} as any, // policy
      {} as any, // refund
      redisMock as any,
      {} as any, // storage
      eventBusMock as any,
      notificationMock as any,
      crmResolverMock,
      crmClaimMock,
      {} as any, // announcements
    );

    return { service, prismaMock, eventBusMock };
  }

  // ─── createBooking ─────────────────────────────────────────────────────────

  it('createBooking : appelle resolveOrCreate par passager et propage customerId au ticket', async () => {
    const resolveOrCreate = jest.fn()
      .mockImplementationOnce(async (_t: string, input: any) => ({
        customer: { id: 'cust-1', phoneE164: '+242061234567', email: null, tenantId },
        created: true,
      }))
      .mockImplementationOnce(async () => ({
        customer: { id: 'cust-2', phoneE164: '+242061111111', email: null, tenantId },
        created: true,
      }));
    const bumpCounters = jest.fn().mockResolvedValue(undefined);
    const issueToken   = jest.fn().mockResolvedValue({ token: 'magic', channels: [], expiresAt: new Date() });
    const recomputeSegmentsFor = jest.fn().mockResolvedValue(undefined);

    const { service, prismaMock } = buildService({ resolveOrCreate, bumpCounters, issueToken, recomputeSegmentsFor });

    const result = await service.createBooking('tenant-a', {
      tripId: 'trip-1',
      passengers: [
        { firstName: 'Alice', lastName: 'Doe',  phone: '061234567', email: 'alice@example.com', seatType: 'STANDARD' },
        { firstName: 'Bob',   lastName: 'Roe',  phone: '061111111',                          seatType: 'STANDARD' },
      ],
      paymentMethod: 'CASH',
    });

    expect(result.tickets).toHaveLength(2);
    expect(resolveOrCreate).toHaveBeenCalledTimes(2);
    expect(resolveOrCreate).toHaveBeenNthCalledWith(1, tenantId,
      expect.objectContaining({ name: 'Alice Doe', phone: '061234567', email: 'alice@example.com' }),
      expect.anything(),
    );
    expect(resolveOrCreate).toHaveBeenNthCalledWith(2, tenantId,
      expect.objectContaining({ name: 'Bob Roe', phone: '061111111' }),
      expect.anything(),
    );

    // bumpCounters invoqué pour chaque passager
    expect(bumpCounters).toHaveBeenCalledTimes(2);

    // ticket.create reçoit customerId et passengerId=null (pas de sentinel)
    const tx = (prismaMock as any).__lastTx;
    const ticketCreateCalls = (tx.ticket.create as jest.Mock).mock.calls;
    expect(ticketCreateCalls).toHaveLength(2);
    expect(ticketCreateCalls[0][0].data).toMatchObject({
      customerId: 'cust-1',
      passengerId: null,
      passengerPhone: '061234567',
      passengerEmail: 'alice@example.com',
    });
    expect(ticketCreateCalls[1][0].data).toMatchObject({
      customerId: 'cust-2',
      passengerId: null,
      passengerPhone: '061111111',
    });
  });

  it('createBooking : émet magic link + recompute segments une fois par customer unique post-tx', async () => {
    const resolveOrCreate = jest.fn().mockResolvedValue({
      customer: { id: 'cust-shared', phoneE164: '+242061234567', email: null, tenantId },
      created: false,
    });
    const bumpCounters = jest.fn().mockResolvedValue(undefined);
    const issueToken   = jest.fn().mockResolvedValue({ token: 'magic', channels: [], expiresAt: new Date() });
    const recomputeSegmentsFor = jest.fn().mockResolvedValue(undefined);

    const { service } = buildService({ resolveOrCreate, bumpCounters, issueToken, recomputeSegmentsFor });

    await service.createBooking('tenant-a', {
      tripId: 'trip-1',
      passengers: [
        { firstName: 'A', lastName: 'X', phone: '061234567', seatType: 'STANDARD' },
        { firstName: 'B', lastName: 'Y', phone: '061234567', seatType: 'STANDARD' },
      ],
      paymentMethod: 'CASH',
    });

    // Laisse le temps aux fire-and-forget
    await new Promise(r => setImmediate(r));

    // Un seul customer partagé → un seul issueToken et un seul recompute
    expect(issueToken).toHaveBeenCalledTimes(1);
    expect(issueToken).toHaveBeenCalledWith(tenantId, 'cust-shared');
    expect(recomputeSegmentsFor).toHaveBeenCalledTimes(1);
  });

  // ─── createParcelPickupRequest ─────────────────────────────────────────────

  it('createParcelPickupRequest : resolve sender + recipient et peuple FK CRM', async () => {
    const resolveOrCreate = jest.fn()
      .mockImplementationOnce(async () => ({
        customer: { id: 'cust-sender', phoneE164: '+242061000001', email: null, tenantId },
        created: true,
      }))
      .mockImplementationOnce(async () => ({
        customer: { id: 'cust-recipient', phoneE164: '+242061000002', email: null, tenantId },
        created: true,
      }));
    const bumpCounters = jest.fn().mockResolvedValue(undefined);
    const issueToken   = jest.fn().mockResolvedValue({ token: 'magic', channels: [], expiresAt: new Date() });
    const recomputeSegmentsFor = jest.fn().mockResolvedValue(undefined);

    const { service, prismaMock } = buildService({ resolveOrCreate, bumpCounters, issueToken, recomputeSegmentsFor });

    const result = await service.createParcelPickupRequest('tenant-a', {
      senderName:    'Alice Sender',
      senderPhone:   '061000001',
      recipientName: 'Bob Recipient',
      recipientPhone:'061000002',
      fromCity:      'Brazzaville',
      toCity:        'Pointe-Noire',
      description:   'Carton 5kg',
      weightKg:      5,
    });

    expect(result.trackingCode).toBeTruthy();
    expect(resolveOrCreate).toHaveBeenCalledTimes(2);
    expect(resolveOrCreate).toHaveBeenNthCalledWith(1, tenantId,
      expect.objectContaining({ name: 'Alice Sender', phone: '061000001' }),
      expect.anything(),
    );
    expect(resolveOrCreate).toHaveBeenNthCalledWith(2, tenantId,
      expect.objectContaining({ name: 'Bob Recipient', phone: '061000002' }),
      expect.anything(),
    );

    // parcel.create reçoit les FK + senderId=null
    const tx = (prismaMock as any).__lastTx;
    const parcelCreate = (tx.parcel.create as jest.Mock).mock.calls[0][0].data;
    expect(parcelCreate).toMatchObject({
      senderId: null,
      senderCustomerId:    'cust-sender',
      recipientCustomerId: 'cust-recipient',
    });

    // Deux bumps (sender + recipient, customers différents)
    expect(bumpCounters).toHaveBeenCalledTimes(2);
  });

  it('createParcelPickupRequest : émet magic link pour sender et recipient post-tx', async () => {
    const resolveOrCreate = jest.fn()
      .mockImplementationOnce(async () => ({
        customer: { id: 'cust-sender', phoneE164: '+242061000001', email: null, tenantId },
        created: true,
      }))
      .mockImplementationOnce(async () => ({
        customer: { id: 'cust-recipient', phoneE164: '+242061000002', email: null, tenantId },
        created: true,
      }));
    const bumpCounters = jest.fn().mockResolvedValue(undefined);
    const issueToken   = jest.fn().mockResolvedValue({ token: 'magic', channels: [], expiresAt: new Date() });
    const recomputeSegmentsFor = jest.fn().mockResolvedValue(undefined);

    const { service } = buildService({ resolveOrCreate, bumpCounters, issueToken, recomputeSegmentsFor });

    await service.createParcelPickupRequest('tenant-a', {
      senderName: 'A', senderPhone: '061000001',
      recipientName: 'B', recipientPhone: '061000002',
      fromCity: 'Brazzaville', toCity: 'Pointe-Noire',
      description: 'X',
    });

    await new Promise(r => setImmediate(r));

    expect(issueToken).toHaveBeenCalledTimes(2);
    expect(issueToken).toHaveBeenCalledWith(tenantId, 'cust-sender');
    expect(issueToken).toHaveBeenCalledWith(tenantId, 'cust-recipient');
  });
});
