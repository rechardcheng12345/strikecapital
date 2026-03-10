import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { db } from './database.js';
import { env } from './env.js';
import { tokenCache } from '../services/tokenCache.js';
const options = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: env.jwtSecret,
};
passport.use(new JwtStrategy(options, async (jwtPayload, done) => {
    try {
        const userId = jwtPayload.id;
        const iat = jwtPayload.iat; // issued-at (seconds), included by jsonwebtoken
        // Check in-memory cache first
        const cached = tokenCache.get(userId, iat);
        if (cached) {
            // Cache hit with an actual user object (not a tombstone)
            if (cached.id) {
                return done(null, cached);
            }
            // Tombstone entry — token was invalidated
            return done(null, false);
        }
        // Cache miss or TTL expired — look up from DB
        const user = await db('users')
            .where({ id: userId })
            .first();
        if (user) {
            tokenCache.set(userId, user);
            // Re-check validity after caching (validAfter may have been preserved)
            const recheck = tokenCache.get(userId, iat);
            if (!recheck || !recheck.id) {
                return done(null, false);
            }
            return done(null, user);
        }
        return done(null, false);
    }
    catch (error) {
        return done(error, false);
    }
}));
export default passport;
