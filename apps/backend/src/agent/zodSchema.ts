import { z } from 'zod';

/**
 * Lightweight zod-to-JSON-schema converter for our tool schemas.
 * Only handles the shapes we actually use (object, string, number, boolean, array, optional, default, enum).
 */
export function zodToJsonSchemaLite(schema: z.ZodTypeAny): unknown {
  const def = schema._def;
  const typeName = def.typeName as string;

  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchemaLite(def.type) };
    case 'ZodOptional':
    case 'ZodDefault':
      return zodToJsonSchemaLite(def.innerType);
    case 'ZodObject': {
      const shape = def.shape() as Record<string, z.ZodTypeAny>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchemaLite(value);
        const inner = value._def.typeName;
        if (inner !== 'ZodOptional' && inner !== 'ZodDefault') required.push(key);
      }
      return { type: 'object', properties, required };
    }
    case 'ZodUnknown':
      return {};
    default:
      return {};
  }
}
