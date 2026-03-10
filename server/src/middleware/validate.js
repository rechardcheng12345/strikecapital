export const validate = (schema) => {
    return (req, _res, next) => {
        schema.parse(req.body);
        next();
    };
};
export const validateQuery = (schema) => {
    return (req, _res, next) => {
        schema.parse(req.query);
        next();
    };
};
export const validateParams = (schema) => {
    return (req, _res, next) => {
        schema.parse(req.params);
        next();
    };
};
