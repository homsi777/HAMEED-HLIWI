import 'dotenv/config';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const boolean = (value: string | undefined, fallback: boolean) => value === undefined ? fallback : value === 'true';

export const appConfig = () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
  const sessionTokenPepper = process.env.SESSION_TOKEN_PEPPER ?? (nodeEnv === 'production' ? required('SESSION_TOKEN_PEPPER') : jwtSecret);
  if (sessionTokenPepper.length < 32) throw new Error('SESSION_TOKEN_PEPPER must be at least 32 characters.');
  const refreshSessionDays = Number(process.env.REFRESH_SESSION_DAYS ?? 14);
  if (!Number.isInteger(refreshSessionDays) || refreshSessionDays < 1 || refreshSessionDays > 90) throw new Error('REFRESH_SESSION_DAYS must be an integer between 1 and 90.');
  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: Number(process.env.PORT ?? 3001),
    databaseUrl: required('DATABASE_URL'),
    databasePoolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    sessionTokenPepper,
    refreshSessionDays,
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map(value => value.trim()).filter(Boolean),
    cookieSecure: boolean(process.env.COOKIE_SECURE, nodeEnv === 'production'),
    trustProxy: boolean(process.env.TRUST_PROXY, nodeEnv === 'production'),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),
    uploadDirectory: process.env.UPLOAD_DIRECTORY ?? 'storage/inventory-images',
    uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024),
  };
};

export type AppConfig = ReturnType<typeof appConfig>;
