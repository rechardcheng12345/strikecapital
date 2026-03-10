import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { updateAndFetch } from '../utils/dbHelpers.js';
const router = Router();
const updateProfileSchema = z.object({
    full_name: z.string().min(2).optional(),
    phone: z.string().optional(),
});
const changePasswordSchema = z.object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(6, 'New password must be at least 6 characters'),
});
// GET /me — Get current user profile
router.get('/me', authenticate, async (req, res, next) => {
    try {
        const user = await db('users')
            .where({ id: req.user.id })
            .select('id', 'email', 'full_name', 'phone', 'role', 'is_active', 'created_at')
            .first();
        res.json(user);
    }
    catch (error) {
        next(error);
    }
});
// PUT /me — Update profile
router.put('/me', authenticate, validate(updateProfileSchema), async (req, res, next) => {
    try {
        const { full_name, phone } = req.body;
        const user = await updateAndFetch('users', { id: req.user.id }, { full_name, phone, updated_at: new Date() });
        res.json(user);
    }
    catch (error) {
        next(error);
    }
});
// PUT /me/password — Change password
router.put('/me/password', authenticate, validate(changePasswordSchema), async (req, res, next) => {
    try {
        const { current_password, new_password } = req.body;
        const user = await db('users').where({ id: req.user.id }).select('password_hash').first();
        const isValid = await bcrypt.compare(current_password, user.password_hash);
        if (!isValid)
            throw new AppError('Current password is incorrect', 400);
        const password_hash = await bcrypt.hash(new_password, 10);
        await db('users').where({ id: req.user.id }).update({ password_hash, updated_at: new Date() });
        res.json({ message: 'Password changed successfully' });
    }
    catch (error) {
        next(error);
    }
});
export default router;
