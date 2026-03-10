import dotenv from 'dotenv';
dotenv.config();
export const env = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    // Database
    databaseUrl: process.env.DATABASE_URL,
    // JWT
    jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
    jwtExpiresIn: (process.env.JWT_EXPIRES_IN || '7d'),
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '180d',
    refreshTokenCookieName: 'refresh_token',
    // Frontend
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};
