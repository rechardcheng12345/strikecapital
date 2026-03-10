import passport from 'passport';
export const authenticate = passport.authenticate('jwt', { session: false });
export const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};
export const optionalAuth = (req, res, next) => {
    passport.authenticate('jwt', { session: false }, (err, user) => {
        if (user) {
            req.user = user;
        }
        next();
    })(req, res, next);
};
