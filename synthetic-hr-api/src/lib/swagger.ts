import swaggerJsdoc from 'swagger-jsdoc';
import { Express } from 'express';
import swaggerUi from 'swagger-ui-express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Synthetic HR API',
      version: '1.0.0',
      description: 'AI Agent Governance Platform - REST API for managing AI agents, incidents, costs, and compliance monitoring',
      contact: {
        name: 'API Support',
        email: 'support@synthetic-hr.com',
      },
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:3001',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Supabase JWT token from authentication',
        },
      },
      schemas: {
        Agent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Customer Support Agent' },
            provider: { type: 'string', enum: ['openai', 'anthropic'] },
            model: { type: 'string', example: 'gpt-4o' },
            status: { type: 'string', enum: ['active', 'paused', 'killed'] },
            kill_switch_triggered: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Incident: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            agent_id: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: ['pii_leak', 'policy_violation', 'refund_abuse', 'legal_advice'] },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            status: { type: 'string', enum: ['open', 'investigating', 'resolved', 'dismissed'] },
            description: { type: 'string' },
            detected_at: { type: 'string', format: 'date-time' },
            resolved_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Invalid request' },
            details: { type: 'string', example: 'Missing required field' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.ts'], // Path to API route files with JSDoc annotations
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express): void {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Synthetic HR API Docs',
  }));

  // Serve OpenAPI spec as JSON
  app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}
