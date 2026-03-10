import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env.js';
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'StrikeCapital API',
            version: '1.0.0',
            description: 'API documentation for StrikeCapital by WYR — Cash-Secured Put Investment Tracking System',
        },
        servers: [
            {
                url: `http://localhost:${env.port}`,
                description: 'Development server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
            schemas: {
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        email: { type: 'string', format: 'email' },
                        full_name: { type: 'string' },
                        phone: { type: 'string' },
                        role: { type: 'string', enum: ['investor', 'admin'] },
                        is_active: { type: 'boolean' },
                        created_at: { type: 'string', format: 'date-time' },
                    },
                },
                Position: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        ticker: { type: 'string' },
                        strike_price: { type: 'number' },
                        premium_received: { type: 'number' },
                        contracts: { type: 'integer' },
                        expiration_date: { type: 'string', format: 'date' },
                        status: { type: 'string', enum: ['OPEN', 'MONITORING', 'ROLLING', 'EXPIRY', 'RESOLVED'] },
                        collateral: { type: 'number' },
                        break_even: { type: 'number' },
                    },
                },
                Error: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' },
                        errors: { type: 'array', items: { type: 'object' } },
                    },
                },
            },
        },
    },
    apis: ['./src/routes/*.js'],
};
export const swaggerSpec = swaggerJsdoc(options);
