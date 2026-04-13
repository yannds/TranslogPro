/**
 * mock-providers.ts
 *
 * Fournit des mocks en mémoire pour tous les providers d'infrastructure.
 * Utilisé par createTestApp() pour substituer Prisma, Redis, Vault, EventBus.
 *
 * Les mocks renvoient des fixtures réalistes qui permettent aux domain services
 * de s'initialiser sans connexion réelle à une base de données.
 */

// ─── Fixtures ─────────────────────────────────────────────────────────────────

export const TENANT_ID = 'a1b2c3d4-0000-0000-0000-000000000001';
export const USER_ID   = 'u1b2c3d4-0000-0000-0000-000000000001';
export const ROLE_ID   = 'r1b2c3d4-0000-0000-0000-000000000001';
export const AGENCY_ID = 'ag1b2c3-0000-0000-0000-000000000001';
export const TRIP_ID   = 'trip0001-0000-0000-0000-000000000001';
export const BUS_ID    = 'bus00001-0000-0000-0000-000000000001';

export const FIXTURE_USER = {
  id:       USER_ID,
  tenantId: TENANT_ID,
  roleId:   ROLE_ID,
  roleName: 'ADMIN',
  agencyId: AGENCY_ID,
  userType: 'STAFF',
};

export const FIXTURE_TRIP = {
  id:         TRIP_ID,
  tenantId:   TENANT_ID,
  status:     'SCHEDULED',
  driverId:   USER_ID,
  busId:      BUS_ID,
  departureAt: new Date('2026-05-01T08:00:00Z'),
  arrivalAt:   new Date('2026-05-01T14:00:00Z'),
  createdAt:   new Date(),
  updatedAt:   new Date(),
  // Relations used by ManifestService
  travelers:  [{ id: 'trv-01', name: 'Jean Dupont' }],
  shipments:  [{ id: 'shp-01', parcels: [{ id: 'pcl-01' }] }],
  bus:        { id: BUS_ID, plate: 'AB-123-CD', capacity: 50 },
  route:      { id: 'route-01', name: 'Dakar → Thiès' },
};

export const FIXTURE_TICKET = {
  id:       'tkt00001-0000-0000-0000-000000000001',
  tenantId: TENANT_ID,
  tripId:   TRIP_ID,
  status:   'CONFIRMED',
  seat:     'A12',
  version:  1,
  createdAt: new Date(),
};

export const FIXTURE_BUS = {
  id:       BUS_ID,
  tenantId: TENANT_ID,
  plate:    'AB-123-CD',
  capacity: 50,
  status:   'AVAILABLE',
};

export const FIXTURE_PARCEL = {
  id:         'pcl00001-0000-0000-0000-000000000001',
  tenantId:   TENANT_ID,
  trackCode:  'TRK-0001',
  status:     'REGISTERED',
  weightKg:   2.5,
  createdAt:  new Date(),
};

export const FIXTURE_MANIFEST = {
  id:         'mfst0001-0000-0000-0000-000000000001',
  tenantId:   TENANT_ID,
  tripId:     TRIP_ID,
  status:     'DRAFT',
  signedAt:   null,
  downloadUrl: null,
  createdAt:  new Date(),
};

export const FIXTURE_REGISTER = {
  id:         'reg00001-0000-0000-0000-000000000001',
  tenantId:   TENANT_ID,
  agentId:    USER_ID,
  status:     'OPEN',
  openedAt:   new Date(),
  closedAt:   null,
};

export const FIXTURE_FEEDBACK = {
  id:         'fbk00001-0000-0000-0000-000000000001',
  tenantId:   TENANT_ID,
  tripId:     TRIP_ID,
  rating:     4,
  comment:    'Bon voyage',
  createdAt:  new Date(),
};

export const FIXTURE_ALERT = {
  id:         'alt00001-0000-0000-0000-000000000001',
  tenantId:   TENANT_ID,
  status:     'OPEN',
  severity:   'HIGH',
  type:       'INCIDENT',
  createdAt:  new Date(),
};

export const FIXTURE_NOTIFICATION = {
  id:         'ntf00001-0000-0000-0000-000000000001',
  tenantId:   TENANT_ID,
  userId:     USER_ID,
  channel:    'IN_APP',
  status:     'PENDING',
  body:       'Test notification',
  attempts:   0,
  createdAt:  new Date(),
};

export const FIXTURE_CREW = [
  { staffId: USER_ID, role: 'DRIVER', briefed: false },
];

export const FIXTURE_REPORT = {
  id:         'rpt00001-0000-0000-0000-000000000001',
  tenantId:   TENANT_ID,
  type:       'SAFETY',
  status:     'PENDING',
  createdAt:  new Date(),
};

export const FIXTURE_BRAND = {
  id:             'brd00001-0000-0000-0000-000000000001',
  tenantId:       TENANT_ID,
  brandName:      'Test Transport',
  logoUrl:        null,
  faviconUrl:     null,
  primaryColor:   '#2563eb',
  secondaryColor: '#1a3a5c',
  accentColor:    '#f59e0b',
  textColor:      '#111827',
  bgColor:        '#ffffff',
  fontFamily:     'Inter, sans-serif',
  customCss:      null,
  metaTitle:      null,
  metaDescription: null,
  supportEmail:   null,
  supportPhone:   null,
  updatedAt:      new Date(),
};

export const FIXTURE_COST_PROFILE = {
  id:                      'cp000001-0000-0000-0000-000000000001',
  tenantId:                TENANT_ID,
  busId:                   BUS_ID,
  fuelConsumptionPer100Km: 28,
  fuelPricePerLiter:       1.45,
  adBlueCostPerLiter:      0.18,
  adBlueRatioFuel:         0.05,
  maintenanceCostPerKm:    0.05,
  stationFeePerDeparture:  500,
  driverAllowancePerTrip:  1500,
  tollFeesPerTrip:         800,
  driverMonthlySalary:     350000,
  annualInsuranceCost:     1200000,
  monthlyAgencyFees:       50000,
  purchasePrice:           45000000,
  depreciationYears:       10,
  residualValue:           5000000,
  avgTripsPerMonth:        30,
  updatedAt:               new Date(),
};

export const FIXTURE_COST_SNAPSHOT = {
  id:                   'snap0001-0000-0000-0000-000000000001',
  tenantId:             TENANT_ID,
  tripId:               TRIP_ID,
  fuelCost:             23226,
  adBlueCost:           116,
  maintenanceCost:      2250,
  stationFee:           500,
  tollFees:             800,
  driverAllowance:      1500,
  totalVariableCost:    28392,
  driverDailyCost:      11667,
  insuranceDailyCost:   3288,
  agencyDailyCost:      1667,
  depreciationDaily:    10959,
  totalFixedCost:       27581,
  totalCost:            55973,
  ticketRevenue:        75000,
  parcelRevenue:        5000,
  totalRevenue:         80000,
  operationalMargin:    51608,
  operationalMarginRate: 1.82,
  agencyCommission:     2250,
  netTenantRevenue:     77750,
  netMargin:            21777,
  marginRate:           0.39,
  bookedSeats:          38,
  totalSeats:           50,
  fillRate:             0.76,
  breakEvenSeats:       30,
  profitabilityTag:     'PROFITABLE',
  computedAt:           new Date(),
};

// ─── Prisma mock ──────────────────────────────────────────────────────────────

/**
 * Prisma mock complet — chaque table expose les méthodes courantes.
 * Les méthodes renvoient des fixtures par défaut (overridables dans chaque test).
 */
export function createPrismaMock() {
  const common = (fixture: unknown) => ({
    findUnique:  jest.fn().mockResolvedValue(fixture),
    findFirst:   jest.fn().mockResolvedValue(fixture),
    findMany:    jest.fn().mockResolvedValue([fixture]),
    create:      jest.fn().mockResolvedValue(fixture),
    update:      jest.fn().mockResolvedValue(fixture),
    delete:      jest.fn().mockResolvedValue(fixture),
    updateMany:  jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany:  jest.fn().mockResolvedValue({ count: 1 }),
    count:       jest.fn().mockResolvedValue(1),
    upsert:      jest.fn().mockResolvedValue(fixture),
    aggregate:   jest.fn().mockResolvedValue({ _avg: { rating: 4.2 }, _count: { id: 10 }, _sum: { amount: 500000 } }),
    groupBy:     jest.fn().mockResolvedValue([{ status: 'COMPLETED', _count: { id: 10 }, _sum: { amount: 500000 } }]),
  });

  return {
    // Auth / IAM
    session:               common({ id: 'sess-01', userId: USER_ID, tenantId: TENANT_ID, token: 'tok-test', expiresAt: new Date(Date.now() + 86400_000) }),
    user:                  common({ id: USER_ID, tenantId: TENANT_ID, roleId: ROLE_ID, email: 'test@example.com', name: 'Test User' }),
    role:                  common({ id: ROLE_ID, tenantId: TENANT_ID, name: 'ADMIN' }),
    rolePermission:        common({ id: 'rp-01', roleId: ROLE_ID, permission: 'data.ticket.read.agency' }),
    tenant:                common({ id: TENANT_ID, name: 'Test Company', slug: 'test-co', status: 'ACTIVE' }),
    impersonationSession:  common({ id: 'sess-test-001', actorId: USER_ID, actorTenantId: '00000000-0000-0000-0000-000000000000', targetTenantId: TENANT_ID, status: 'ACTIVE', expiresAt: new Date(Date.now() + 900_000), tokenHash: 'mock-hash', createdAt: new Date() }),

    // Domain
    trip:                  common(FIXTURE_TRIP),
    ticket:                common(FIXTURE_TICKET),
    bus:                   common(FIXTURE_BUS),
    parcel:                common(FIXTURE_PARCEL),
    manifest:              common(FIXTURE_MANIFEST),
    cashierRegister:       common(FIXTURE_REGISTER),
    cashierTransaction:    common({ id: 'tx-01', amount: 5000, type: 'IN', createdAt: new Date() }),
    // Real Prisma model names used by CashierService
    cashRegister:          common({ ...FIXTURE_REGISTER, totalIn: 150000, totalOut: 20000 }),
    transaction:           common({ id: 'tx-01', amount: 5000, type: 'IN', registerId: FIXTURE_REGISTER.id, createdAt: new Date() }),
    // Staff model (used by CrewService, StaffModule)
    staff:                 common({ id: 'stf-01', userId: USER_ID, tenantId: TENANT_ID, agencyId: AGENCY_ID, role: 'DRIVER', status: 'ACTIVE' }),
    feedback:              common(FIXTURE_FEEDBACK),
    rating:                common({ entityId: TRIP_ID, averageRating: 4.2, count: 10 }),
    safetyAlert:           common(FIXTURE_ALERT),
    crewAssignment:        common(FIXTURE_CREW[0]),
    notification:          common(FIXTURE_NOTIFICATION),
    notificationPreference: common({ channel: 'IN_APP', enabled: true }),
    publicReport:          common(FIXTURE_REPORT),
    gpsPosition:           common({ lat: 4.05, lng: 9.76, recordedAt: new Date() }),
    tripTemplate:          common({ id: 'tpl-01', name: 'Dakar→Thiès', tenantId: TENANT_ID }),
    workflowConfig:        common({ fromState: 'CONFIRMED', toState: 'BOARDED', action: 'BOARD', requiredPerm: 'data.ticket.scan.agency', guards: [], isActive: true }),
    workflowTransition:    common(null),
    auditLog:              common({ id: 'audit-01' }),
    outboxEvent:           common({ id: 'out-01', status: 'PENDING' }),
    deadLetterEvent:       common({ id: 'dl-01', status: 'DEAD' }),
    notificationTemplate:  common({ id: 'tpl-01', channel: 'SMS', body: 'Hello {{name}}' }),
    campaign:              common({ id: 'cam-01', status: 'DRAFT', tenantId: TENANT_ID }),
    sapTicket:             common({ id: 'sap-01', status: 'OPEN' }),
    vehicle:               common({ id: BUS_ID, plate: 'AB-123-CD' }),
    maintenanceRecord:     common({ id: 'mnt-01', status: 'PENDING' }),
    maintenanceReport:     common({ id: 'mnt-01', busId: BUS_ID, tenantId: TENANT_ID, status: 'PENDING', type: 'CORRECTIVE', description: 'Panne frein', createdAt: new Date() }),
    incident:              common({ id: 'inc-01', tenantId: TENANT_ID, type: 'BREAKDOWN', severity: 'HIGH', status: 'OPEN', isSos: false, reportedById: USER_ID, createdAt: new Date() }),
    claim:                 common({ id: 'clm-01', tenantId: TENANT_ID, type: 'DAMAGE', status: 'OPEN', description: 'Test', createdAt: new Date() }),
    traveler:              common({ id: 'trv-01', tenantId: TENANT_ID, userId: USER_ID, name: 'Jean Dupont', phone: '+221700000000', createdAt: new Date() }),
    checklist:             common({ id: 'chk-01', tenantId: TENANT_ID, tripId: TRIP_ID, item: 'Vérification freins', completed: false, createdAt: new Date() }),
    route:                 common({ id: 'route-01', tenantId: TENANT_ID, name: 'Dakar → Thiès' }),
    waypoint:              common({ id: 'wp-01', routeId: 'route-01', name: 'Rufisque', order: 1 }),
    travelDocument:        common({ id: 'doc-01', type: 'ID_CARD' }),
    quotaRule:             common({ id: 'quota-01', entityType: 'ticket', limit: 1000 }),
    onboardingStep:        common({ step: 'PROFILE', completed: true }),
    tenantConfig:          common(null),   // null → TenantConfigService retourne DEFAULT_CONFIG
    tenantBrand:           common(FIXTURE_BRAND),
    tenantBusinessConfig:  common(null),   // null → DEFAULT_BUSINESS_CONSTANTS dans ProfitabilityService
    busCostProfile:        common(FIXTURE_COST_PROFILE),
    tripCostSnapshot:      common(FIXTURE_COST_SNAPSHOT),
    tripAnalytics:         common({ id: 'ta-01', tenantId: TENANT_ID, routeId: 'route-01', busId: BUS_ID, avgFillRate: 0.76, isGoldenDay: false, isBlackRoute: false, dayOfWeek: 1, tripDate: new Date(), createdAt: new Date() }),
    installedModule:       common({ id: 'im-01', tenantId: TENANT_ID, moduleKey: 'YIELD_ENGINE', isActive: true, config: {} }),

    // Prisma transactions
    $transaction:  jest.fn().mockImplementation((fn: unknown) => typeof fn === 'function' ? fn({}) : Promise.resolve(fn)),
    $queryRaw:     jest.fn().mockResolvedValue([{ version: 1 }]),
    $executeRaw:   jest.fn().mockResolvedValue(1),
    transact:      jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
}

// ─── Redis mock ───────────────────────────────────────────────────────────────

export function createRedisMock() {
  return {
    get:              jest.fn().mockResolvedValue(null),
    set:              jest.fn().mockResolvedValue('OK'),
    setex:            jest.fn().mockResolvedValue('OK'),  // used by PermissionGuard cache
    setnx:            jest.fn().mockResolvedValue(1),
    del:              jest.fn().mockResolvedValue(1),
    exists:           jest.fn().mockResolvedValue(0),
    expire:           jest.fn().mockResolvedValue(1),
    zadd:             jest.fn().mockResolvedValue(1),
    zcard:            jest.fn().mockResolvedValue(0),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    lrange:           jest.fn().mockResolvedValue([]),
    lpush:            jest.fn().mockResolvedValue(1),
    ltrim:            jest.fn().mockResolvedValue('OK'),
    publish:          jest.fn().mockResolvedValue(0),
    psubscribe:       jest.fn().mockResolvedValue(undefined),
    on:               jest.fn(),
    pipeline:         jest.fn().mockReturnValue({
      zadd:             jest.fn().mockReturnThis(),
      zremrangebyscore: jest.fn().mockReturnThis(),
      zcard:            jest.fn().mockReturnThis(),
      expire:           jest.fn().mockReturnThis(),
      exec:             jest.fn().mockResolvedValue([[null, 1], [null, 0], [null, 0], [null, 1]]),
    }),
    quit:    jest.fn().mockResolvedValue('OK'),
    connect: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── SecretService mock ───────────────────────────────────────────────────────

export function createSecretMock() {
  const secrets: Record<string, Record<string, string>> = {
    'platform/redis':         { HOST: 'localhost', PORT: '6379' },
    'platform/db':            { DATABASE_URL: 'postgresql://localhost/test' },
    'platform/flutterwave':   { SECRET_KEY: 'FLWSECK_TEST-MOCK', WEBHOOK_HASH: 'mock-webhook-hash' },
    'platform/paystack':      { SECRET_KEY: 'sk_test_MOCK' },
    'platform/sms':           { ACCOUNT_SID: 'ACmock', AUTH_TOKEN: 'mock', FROM_NUMBER: '+33600000000' },
    'platform/whatsapp':      { ACCOUNT_SID: 'ACmock', AUTH_TOKEN: 'mock', FROM_NUMBER: 'whatsapp:+14155238886' },
    'platform/openweathermap': { API_KEY: 'mock-weather-key' },
    'platform/auth':          { SECRET: 'mock-secret-64chars', JWT_SECRET: 'mock-jwt-secret' },
    'platform/minio':         { ENDPOINT: 'localhost', PORT: '9000', ACCESS_KEY: 'minioadmin', SECRET_KEY: 'minioadmin', USE_SSL: 'false' },
    'platform/impersonation_key': { KEY: 'a'.repeat(64) },
    [`tenants/${TENANT_ID}/hmac`]: { KEY: 'b'.repeat(64) },
  };

  return {
    getSecret: jest.fn().mockImplementation((path: string) => {
      const parts = path.split('/');
      const key   = parts.pop()!;
      const group = parts.join('/');
      return Promise.resolve(secrets[group]?.[key] ?? 'mock-value');
    }),
    getSecretObject: jest.fn().mockImplementation((path: string) => {
      return Promise.resolve(secrets[path] ?? { KEY: 'mock' });
    }),
  };
}

// ─── EventBus mock ────────────────────────────────────────────────────────────

export function createEventBusMock() {
  return {
    publish:  jest.fn().mockResolvedValue(undefined),
    emit:     jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn().mockReturnValue(createRedisMock()),
  };
}
