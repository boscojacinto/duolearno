import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Fields that Gemini's function-calling API rejects outright.
const UNSUPPORTED_FIELDS = new Set([
  "$schema",
  "additionalProperties",
  "default",
  "const",
]);

function stripUnsupported(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUnsupported);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!UNSUPPORTED_FIELDS.has(k)) {
        result[k] = stripUnsupported(v);
      }
    }
    return result;
  }
  return value;
}

/**
 * Converts a Zod schema to a Gemini-compatible JSON schema.
 * - Inlines all $ref definitions ($refStrategy "none")
 * - Strips fields Gemini's proto API rejects: $schema, additionalProperties, default, const
 */
export function toGeminiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = zodToJsonSchema(schema as any, {
    $refStrategy: "none",
    target: "jsonSchema7",
  });
  return stripUnsupported(raw) as Record<string, unknown>;
}
