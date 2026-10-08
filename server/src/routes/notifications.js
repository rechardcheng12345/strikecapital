import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { preferencesFor, savePreferences, enqueuePush, queueAccountSummary } from '../services/ntfyService.js';

const router = Router();
router.use(authenticate);
router.use((req, _res, next) => req.user.is_active ? next() : next(new AppError('Account is inactive', 403)));
const preferencesSchema = z.object({
    enabled: z.boolean(), events: z.array(z.string()).max(20),
    summary_frequency: z.enum(['weekly', 'daily', 'manual']),
}).strict();
router.get('/preferences', async (req, res, next) => {
    try { res.json(await preferencesFor(req.user)); } catch (error) { next(error); }
});
router.put('/preferences', async (req, res, next) => {
    try {
        if (!req.user.is_active) throw new AppError('Account is inactive', 403);
        res.json(await savePreferences(req.user, preferencesSchema.parse(req.body)));
    } catch (error) { next(error); }
});
// Both roles can see their own notification history; never accept a recipient ID from the client.
router.get('/', async (req, res, next) => {
    try {
        const notifications = await db('notifications').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(30);
        const deliveries = await db('notification_deliveries').where({ user_id: req.user.id })
            .orderBy('id', 'desc').limit(10).select('id', 'event', 'status', 'attempts', 'last_error', 'created_at', 'sent_at');
        res.json({ notifications, deliveries });
    } catch (error) { next(error); }
});
router.put('/:id/read', async (req, res, next) => {
    try {
        await db('notifications').where({ id: req.params.id, user_id: req.user.id }).update({ is_read: true });
        res.json({ message: 'Notification marked as read' });
    } catch (error) { next(error); }
});
router.post('/test', async (req, res, next) => {
    try {
        const prefs = await preferencesFor(req.user);
        if (!req.user.is_active || !env.ntfyEnabled || !prefs.enabled) throw new AppError('Enable notifications first', 400);
        const recent = await db('notification_deliveries').where({ user_id: req.user.id, event: 'test' })
            .where('created_at', '>', new Date(Date.now() - 60000)).first();
        if (recent) throw new AppError('Please wait one minute before sending another test', 429);
        await enqueuePush(req.user.id, 'test', 'StrikeCapital: Test notification', 'Your notifications are connected.', req.user.role === 'admin' ? '/admin/profile' : '/profile');
        res.status(202).json({ message: 'Test queued. Delivery status will appear below.' });
    } catch (error) { next(error); }
});
router.post('/summary', async (req, res, next) => {
    try {
        const recent = await db('notification_deliveries').where({ user_id: req.user.id, event: 'account_summary' })
            .where('created_at', '>', new Date(Date.now() - 60000)).first();
        if (recent) throw new AppError('Please wait one minute before requesting another summary', 429);
        if (!await queueAccountSummary(req.user)) throw new AppError('Enable account summary notifications first', 400);
        res.status(202).json({ message: 'Account summary queued' });
    } catch (error) { next(error); }
});
export default router;
