/**
 * connector-service.ts
 *
 * Re-exports core connector validation utilities from routes/connectors.ts.
 * Routes and tests import from here to avoid reaching into route modules directly.
 */

export {
  redactSensitiveConfig,
  validateRequiredCredentials,
  validateProviderConnection,
  type ConnectorValidationResult,
} from '../routes/connectors';
