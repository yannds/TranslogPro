// Placeholder — no real DB needed (all mocked)
export default async function globalSetup(): Promise<void> {
  process.env['NODE_ENV'] = 'test';
}
