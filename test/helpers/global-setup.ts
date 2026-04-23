// Placeholder — no real DB needed (all mocked)
export default async function globalSetup(): Promise<void> {
  // @types/node ≥22 marque NODE_ENV readonly. On contourne via Reflect/cast.
  (process.env as Record<string, string>)['NODE_ENV'] = 'test';
}
