import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(__dirname, '../../../..', envFile) });
export const env = {
    nodeEnv: NODE_ENV,
    port: parseInt(process.env.PORT || '3000', 10),
    // Database
    dbHost:     process.env.DB_HOST     || 'localhost',
    dbPort:     parseInt(process.env.DB_PORT || '3306'),
    dbName:     process.env.DB_NAME     || 'strikecapital',
    dbUser:     process.env.DB_USER     || 'root',
    dbPassword: process.env.DB_PASSWORD || '',
    // JWT
    jwtSecret:            process.env.JWT_SECRET            || 'default-secret-change-me',
    jwtExpiresIn:         process.env.JWT_EXPIRES_IN        || '7d',
    jwtAccessExpiresIn:   process.env.JWT_ACCESS_EXPIRES_IN  || '15m',
    jwtRefreshExpiresIn:  process.env.JWT_REFRESH_EXPIRES_IN || '180d',
    refreshTokenCookieName: 'refresh_token',
    // Frontend
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    corsOrigins: process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173',
};
