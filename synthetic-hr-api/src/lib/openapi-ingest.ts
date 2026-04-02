import crypto from 'crypto';

export type OpenApiCapability = {
  operation_id: string;
  method: string;
  path: string;
  label: string;
  risk: 'low' | 'medium' | 'high';
  operation: 'read' | 'create' | 'update' | 'delete' | 'execute';
  object_type: string;
  requires_approval_default: boolean;
  schema: Record<string, any> | null;
};

export type OpenApiIngestResult = {
  service_id: string;
  title: string;
  version: string;
  capabilities: OpenApiCapability[];
  spec_hash: string;
};

function inferOperation(method: string): OpenApiCapability['operation'] {
  const m = method.toLowerCase();
  if (m === 'get' || m === 'head') return 'read';
  if (m === 'post') return 'create';
  if (m === 'put' || m === 'patch') return 'update';
  if (m === 'delete') return 'delete';
  return 'execute';
}

function inferRisk(method: string, operationId: string, path: string): OpenApiCapability['risk'] {
  const text = `${method} ${operationId} ${path}`.toLowerCase();
  if (text.includes('delete') || text.includes('refund') || text.includes('revoke') || text.includes('terminate')) return 'high';
  if (text.includes('update') || text.includes('assign') || text.includes('approve') || text.includes('pay')) return 'medium';
  return 'low';
}

function inferObjectType(path: string): string {
  const clean = path.replace(/[{}]/g, '').split('/').filter(Boolean);
  return clean[clean.length - 1] || 'record';
}

export function parseOpenApiToCapabilities(spec: Record<string, any>, serviceId: string): OpenApiIngestResult {
  const title = String(spec?.info?.title || serviceId);
  const version = String(spec?.info?.version || '1.0.0');
  const paths = spec?.paths && typeof spec.paths === 'object' ? spec.paths : {};

  const capabilities: OpenApiCapability[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue;
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      const lowerMethod = method.toLowerCase();
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(lowerMethod)) continue;

      const operationId = String(
        operation?.operationId
        || `${lowerMethod}_${String(path).replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '')}`
      );
      const operationType = inferOperation(lowerMethod);
      const risk = inferRisk(lowerMethod, operationId, String(path));
      const summary = String(operation?.summary || operation?.description || operationId);

      capabilities.push({
        operation_id: operationId,
        method: lowerMethod.toUpperCase(),
        path: String(path),
        label: summary,
        risk,
        operation: operationType,
        object_type: inferObjectType(String(path)),
        requires_approval_default: risk === 'high',
        schema: operation?.requestBody?.content?.['application/json']?.schema || null,
      });
    }
  }

  const specHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(spec))
    .digest('hex');

  return {
    service_id: serviceId,
    title,
    version,
    capabilities,
    spec_hash: specHash,
  };
}
