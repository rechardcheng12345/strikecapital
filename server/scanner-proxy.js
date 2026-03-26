/**
 * Scanner Proxy Server
 * Run this on the always-on PC that has Moomoo OpenD running.
 * Exposes an HTTP endpoint that Hostinger calls to scan options.
 *
 * Usage:
 *   cd server
 *   SCANNER_PROXY_SECRET=yourSecret node scanner-proxy.js
 *
 * Cloudflare tunnel should point to http://localhost:3001
 */

import express from 'express';
import { scanPutOptions } from './src/services/scannerService.js';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.SCANNER_PROXY_PORT || '3001');
const SECRET = process.env.SCANNER_PROXY_SECRET || '';

// Optional shared-secret auth
app.use((req, res, next) => {
    if (SECRET && req.headers['x-proxy-secret'] !== SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/scan', async (req, res) => {
    const { tickers, stockPrices, minDays = 12, maxDays = 20, minDiscount = 10, maxDiscount = 20 } = req.body || {};
    if (!tickers || !stockPrices) {
        return res.status(400).json({ error: 'tickers and stockPrices are required' });
    }
    const result = await scanPutOptions(tickers, stockPrices, minDays, maxDays, minDiscount, maxDiscount);
    res.json(result);
});

app.listen(PORT, () => {
    console.log(`[ScannerProxy] Listening on port ${PORT}`);
    console.log(`[ScannerProxy] Secret auth: ${SECRET ? 'enabled' : 'disabled'}`);
    console.log(`[ScannerProxy] Health: http://localhost:${PORT}/health`);
});
