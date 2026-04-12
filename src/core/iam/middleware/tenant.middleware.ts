/**
 * Re-exports RlsMiddleware from the database layer under the IAM path.
 * The middleware lives with the DB layer because it sets the AsyncLocalStorage
 * tenant context used by PrismaService.
 */
export { RlsMiddleware as TenantMiddleware } from '../../../infrastructure/database/rls.middleware';
