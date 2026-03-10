import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { env } from './config/env.js';
import { swaggerSpec } from './config/swagger.js';
import passport from './config/passport.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import positionRoutes from './routes/positions.js';
import fundRoutes from './routes/fund.js';
import adminRoutes from './routes/admin.js';
import investorRoutes from './routes/investor.js';
// Import services
import { startExpiryAlertJob } from './services/notificationEngine.js';
const app = express();
// Create directories if needed
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir))
    fs.mkdirSync(uploadsDir, { recursive: true });
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir))
    fs.mkdirSync(logsDir, { recursive: true });
// CORS
const corsOrigins = env.corsOrigins.split(',').map(o => o.trim());
console.log(`CORS Origins: ${corsOrigins.join(', ')}`);
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log(`CORS blocked origin: ${origin}`);
            callback(new Error(`Not allowed by CORS: ${origin}`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};
// Middleware
app.use(helmet());
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());
// API Documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));
// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/fund', fundRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/investor', investorRoutes);
// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Serve client build in production
if (env.nodeEnv === 'production') {
    const clientBuildPath = path.join(__dirname, '../../client/dist');
    app.use(express.static(clientBuildPath));
    app.get('*', (req, res) => {
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    });
    console.log(`Serving frontend from: ${clientBuildPath}`);
}
// Error handling
app.use(notFoundHandler);
app.use(errorHandler);
// Start server
app.listen(env.port, () => {
    console.log(`StrikeCapital API running on http://localhost:${env.port}`);
    console.log(`API Docs: http://localhost:${env.port}/api/docs`);
    // Start expiry alert job (check every 60 minutes)
    startExpiryAlertJob(60);
});
export default app;
