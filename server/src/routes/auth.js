import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { emailService } from '../services/emailService.js';
import { logAudit } from '../services/auditLogger.js';
import { tokenCache } from '../services/tokenCache.js';
import { insertAndFetch } from '../utils/dbHelpers.js';
const router = Router();
// Helper function to generate refresh token and store in DB
async function generateRefreshToken(userId) {
    const token = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 180); // 180 days from now
    // Clean up expired tokens for this user (housekeeping)
    await db('refresh_tokens')
        .where({ user_id: userId })
        .where('expires_at', '<=', new Date())
        .del();
    // Store new refresh token
    await db('refresh_tokens').insert({
        user_id: userId,
        token,
        expires_at: expiresAt,
    });
    return token;
}
// Helper function to set refresh token cookie
function setRefreshTokenCookie(res, token) {
    res.cookie(env.refreshTokenCookieName, token, {
        httpOnly: true,
        secure: env.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: 180 * 24 * 60 * 60 * 1000, // 180 days in ms
        path: '/',
    });
}
// Validation schemas
const registerSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    full_name: z.string().min(2, 'Name must be at least 2 characters'),
    contact_number: z.string().optional(),
});
const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});
const forgotPasswordSchema = z.object({
    email: z.string().email('Invalid email address'),
});
const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Token is required'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
});
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, full_name]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               full_name:
 *                 type: string
 *               contact_number:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error or email already exists
 */
router.post('/register', validate(registerSchema), async (req, res, next) => {
    try {
        const { email, password, full_name, contact_number } = req.body;
        // Check if email exists
        const existingUser = await db('users').where({ email }).first();
        if (existingUser) {
            throw new AppError('Email already registered', 400);
        }
        // Hash password
        const password_hash = await bcrypt.hash(password, 10);
        // Create user
        const user = await insertAndFetch('users', {
            email,
            password_hash,
            full_name,
            phone: contact_number || null,
            role: 'investor',
        });
        // Generate short-lived access token
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, env.jwtSecret, { expiresIn: env.jwtAccessExpiresIn });
        // Generate and store refresh token
        const refreshToken = await generateRefreshToken(user.id);
        setRefreshTokenCookie(res, refreshToken);
        res.status(201).json({
            message: 'Registration successful',
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                is_active: user.is_active ?? true,
            },
            token,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', validate(loginSchema), async (req, res, next) => {
    try {
        const { email, password } = req.body;
        // Find user
        const user = await db('users').where({ email }).first();
        if (!user) {
            throw new AppError('Invalid email or password', 401);
        }
        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            throw new AppError('Invalid email or password', 401);
        }
        // Generate short-lived access token
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, env.jwtSecret, { expiresIn: env.jwtAccessExpiresIn });
        // Generate and store refresh token
        const refreshToken = await generateRefreshToken(user.id);
        setRefreshTokenCookie(res, refreshToken);
        // Log login activity
        await logAudit({
            userId: user.id,
            action: 'user.login',
            entityType: 'user',
            entityId: user.id,
            ipAddress: req.ip,
        });
        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                is_active: user.is_active ?? true,
            },
            token,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 *     description: Uses httpOnly cookie to get a new access token
 *     responses:
 *       200:
 *         description: New access token issued
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh', async (req, res, next) => {
    try {
        const refreshToken = req.cookies?.[env.refreshTokenCookieName];
        if (!refreshToken) {
            throw new AppError('No refresh token provided', 401);
        }
        // Find refresh token in database
        const storedToken = await db('refresh_tokens')
            .where({ token: refreshToken })
            .where('expires_at', '>', new Date())
            .first();
        if (!storedToken) {
            // Clear invalid cookie
            res.clearCookie(env.refreshTokenCookieName);
            throw new AppError('Invalid or expired refresh token', 401);
        }
        // Get user
        const user = await db('users')
            .where({ id: storedToken.user_id })
            .first();
        if (!user) {
            await db('refresh_tokens').where({ id: storedToken.id }).del();
            res.clearCookie(env.refreshTokenCookieName);
            throw new AppError('User not found', 401);
        }
        // Generate new access token
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, env.jwtSecret, { expiresIn: env.jwtAccessExpiresIn });
        // Rotate this specific refresh token (preserves other devices' sessions)
        const newRefreshTokenValue = crypto.randomBytes(40).toString('hex');
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 180);
        await db('refresh_tokens').where({ id: storedToken.id }).update({
            token: newRefreshTokenValue,
            expires_at: newExpiresAt,
        });
        setRefreshTokenCookie(res, newRefreshTokenValue);
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                is_active: user.is_active,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout user
 *     description: Clears refresh token from database and cookie
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post('/logout', async (req, res, next) => {
    try {
        const refreshToken = req.cookies?.[env.refreshTokenCookieName];
        if (refreshToken) {
            // Look up token to get user_id, then delete and clear cache
            const storedToken = await db('refresh_tokens').where({ token: refreshToken }).first();
            if (storedToken) {
                await db('refresh_tokens').where({ id: storedToken.id }).del();
                tokenCache.clear(storedToken.user_id);
            }
        }
        // Clear cookie
        res.clearCookie(env.refreshTokenCookieName, {
            httpOnly: true,
            secure: env.nodeEnv === 'production',
            sameSite: 'lax',
            path: '/',
        });
        res.json({ message: 'Logged out successfully' });
    }
    catch (error) {
        next(error);
    }
});
/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request password reset
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Reset email sent if account exists
 */
router.post('/forgot-password', validate(forgotPasswordSchema), async (req, res, next) => {
    try {
        const { email } = req.body;
        const user = await db('users').where({ email }).first();
        // Always return success to prevent email enumeration
        if (!user) {
            return res.json({ message: 'If the email exists, a reset link has been sent' });
        }
        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpires = new Date(Date.now() + 3600000); // 1 hour
        await db('users')
            .where({ id: user.id })
            .update({
            reset_token: resetToken,
            reset_token_expires: resetTokenExpires,
        });
        // Send email (non-blocking)
        emailService.sendPasswordReset(email, resetToken)
            .catch(err => console.error('[Email] Failed to send password reset:', err));
        res.json({ message: 'If the email exists, a reset link has been sent' });
    }
    catch (error) {
        next(error);
    }
});
/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password with token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired token
 */
router.post('/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
    try {
        const { token, password } = req.body;
        const user = await db('users')
            .where({ reset_token: token })
            .where('reset_token_expires', '>', new Date())
            .first();
        if (!user) {
            throw new AppError('Invalid or expired reset token', 400);
        }
        const password_hash = await bcrypt.hash(password, 10);
        await db('users')
            .where({ id: user.id })
            .update({
            password_hash,
            reset_token: null,
            reset_token_expires: null,
        });
        // Log password reset activity
        await logAudit({
            userId: user.id,
            action: 'user.password_reset',
            entityType: 'user',
            entityId: user.id,
            ipAddress: req.ip,
        });
        res.json({ message: 'Password reset successful' });
    }
    catch (error) {
        next(error);
    }
});
export default router;
