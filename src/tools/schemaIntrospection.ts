/**
 * Live schema introspection for `describe_resource_schema`.
 *
 * Ports the behaviour of the Python `cognigy-vibe-mcp` sibling project's
 * `schema_tools.py`: instead of relying on a hardcoded registry (see
 * `nodeRegistry.ts`), this fetches the *live* OpenAPI spec and the live
 * flow-chart node-descriptor catalog from the Cognigy platform, so the
 * model can introspect real field requirements instead of guessing.
 *
 * Two data sources, each cached in-memory with a TTL so repeated calls in
 * the same server process don't refetch:
 *   - The full OpenAPI spec (~8MB) — `GET /openapi/openapi-viewer.json`.
 *   - The project-wide flow-chart node-descriptor catalog (per node type
 *     `config` shape) — `GET /v2.0/flows/{flowId}/chart/descriptors`.
 *
 * The cache is a simple module-level Map keyed by cache name, holding the
 * fetched value plus the timestamp it was cached at — no new dependencies,
 * and it resets on server restart (in-memory only, unlike the Python
 * source's on-disk cache).
 */

import { CognigyApiClient } from "../api/client.js";

const SPEC_TTL_MS = 24 * 60 * 60 * 1000; // 24h, matching the Python source's cache TTL

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string, ttlMs: number): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > ttlMs) return undefined;
  return entry.value;
}

function setCached<T>(key: string, value: T): void {
  cache.set(key, { value, cachedAt: Date.now() });
}

/** Test-only: clears the module-level cache so tests don't leak state across cases. */
export function _clearSchemaIntrospectionCache(): void {
  cache.clear();
}

const OPENAPI_SPEC_CACHE_KEY = "openapi-spec";

export async function getOpenApiSpec(
  apiClient: CognigyApiClient,
): Promise<any> {
  const cached = getCached<any>(OPENAPI_SPEC_CACHE_KEY, SPEC_TTL_MS);
  if (cached) return cached;

  const spec = await apiClient.get("/openapi/openapi-viewer.json");
  setCached(OPENAPI_SPEC_CACHE_KEY, spec);
  return spec;
}

export interface ChartDescriptorsResult {
  descriptors: any[];
  nextCursor: string | null;
}

export async function getChartDescriptors(
  apiClient: CognigyApiClient,
  flowId: string,
): Promise<ChartDescriptorsResult> {
  // The live endpoint returns the project-wide node-type catalog regardless
  // of which flow_id in the project is queried (verified in the Python
  // source). This client is stateless (no persistent project id), so the
  // cache is keyed by flowId rather than project id — a simplification vs.
  // the Python source, at the cost of one avoidable cache miss per distinct
  // flowId a caller happens to pass for the same underlying project.
  const cacheKey = `chart-descriptors:${flowId}`;
  const cached = getCached<ChartDescriptorsResult>(cacheKey, SPEC_TTL_MS);
  if (cached) return cached;

  const resp = await apiClient.get(`/v2.0/flows/${flowId}/chart/descriptors`);
  const descriptors = Array.isArray(resp) ? resp : (resp?.items ?? []);
  const nextCursor = Array.isArray(resp) ? null : (resp?.nextCursor ?? null);
  const result: ChartDescriptorsResult = { descriptors, nextCursor };
  setCached(cacheKey, result);
  return result;
}

// -----------------------------------------------------------------------
// resource_type normalisation
// -----------------------------------------------------------------------

// Mirrors the alias table used by the sibling Python project's flow_ops.py
// (_RESOURCE_TYPE_ALIASES) for the resource types this plugin's tools deal
// with. Unlike that project's own _normalise_rtype (which preserves case on
// a miss), this lowercases on a miss too — OpenAPI path segments are always
// lowercase, and the fallback feeds directly into path lookups like
// `/v2.0/{rtype}`.
const RESOURCE_TYPE_ALIASES: Record<string, string> = {
  project: "projects",
  flow: "flows",
  endpoint: "endpoints",
  agent: "aiagents",
  "ai-agent": "aiagents",
  aiagent: "aiagents",
  "knowledge-store": "knowledgestores",
  knowledgestore: "knowledgestores",
  function: "functions",
  connection: "connections",
  extension: "extensions",
  locale: "locales",
  lexicon: "lexicons",
  snapshot: "snapshots",
  playbook: "playbooks",
  node: "node",
  nodes: "node",
};

export function normaliseResourceType(resourceType: string): string {
  const lower = resourceType.toLowerCase();
  return RESOURCE_TYPE_ALIASES[lower] ?? lower;
}

// -----------------------------------------------------------------------
// OpenAPI path/operation resolution
// -----------------------------------------------------------------------

export type SchemaOperation = "create" | "update" | "get" | "list" | "delete";

const OPERATION_METHOD: Record<SchemaOperation, string> = {
  create: "post",
  update: "patch",
  get: "get",
  list: "get",
  delete: "delete",
};

const HTTP_METHODS = new Set(Object.values(OPERATION_METHOD));

const TOP_LEVEL_PATH_RE = /^\/v2\.0\/[a-zA-Z]+$/;

export function findCandidatePath(
  paths: Record<string, any>,
  rtype: string,
  operation: SchemaOperation,
): { path: string | null; exact: boolean } {
  if (operation === "create" || operation === "list") {
    const candidate = `/v2.0/${rtype}`;
    if (paths[candidate]) return { path: candidate, exact: true };
  } else {
    const prefix = `/v2.0/${rtype}/`;
    for (const p of Object.keys(paths)) {
      if (p.startsWith(prefix)) {
        const remainder = p.slice(prefix.length);
        if (
          remainder.startsWith("{") &&
          remainder.endsWith("}") &&
          !remainder.includes("/")
        ) {
          return { path: p, exact: true };
        }
      }
    }
  }
  for (const p of Object.keys(paths).sort()) {
    if (p.includes(rtype)) return { path: p, exact: false };
  }
  return { path: null, exact: false };
}

export function knownResourceTypes(paths: Record<string, any>): string[] {
  return Object.keys(paths)
    .filter((p) => TOP_LEVEL_PATH_RE.test(p))
    .map((p) => p.split("/")[2])
    .sort();
}

const COMPOSITION_KEYS = ["$ref", "oneOf", "allOf", "anyOf"];

/**
 * True when a schema has no flat 'properties' but uses $ref/oneOf/allOf/anyOf
 * composition instead — extracting fields from these would silently yield [].
 */
export function isComposedSchema(schema: any): boolean {
  if (!schema || typeof schema !== "object") return false;
  return (
    !("properties" in schema) && COMPOSITION_KEYS.some((key) => key in schema)
  );
}

const COMPONENTS_SCHEMA_REF_RE = /^#\/components\/schemas\/([^/]+)$/;

function resolveComponentRef(ref: string, spec: any): any | undefined {
  const match = COMPONENTS_SCHEMA_REF_RE.exec(ref);
  if (!match) return undefined;
  const name = match[1];
  return spec?.components?.schemas?.[name];
}

/**
 * Resolve a bare {"$ref": "#/components/schemas/X"} schema fragment (or a
 * single-level allOf wrapping one) against the full spec's components.schemas.
 * Falls back to returning the schema unchanged if it isn't a $ref/allOf-$ref
 * shape, or if the ref doesn't resolve to anything in components.schemas.
 */
export function resolveSchemaRef(schema: any, spec: any): any {
  if (schema && typeof schema === "object" && typeof schema.$ref === "string") {
    const resolved = resolveComponentRef(schema.$ref, spec);
    return resolved !== undefined ? resolved : schema;
  }

  if (schema && Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    let mergedProperties: Record<string, any> = {};
    const mergedRequired = new Set<string>();
    let resolvedAny = false;
    for (const entry of schema.allOf) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.$ref === "string") {
        const resolved = resolveComponentRef(entry.$ref, spec);
        if (resolved === undefined) continue;
        resolvedAny = true;
        mergedProperties = {
          ...mergedProperties,
          ...(resolved.properties ?? {}),
        };
        for (const r of resolved.required ?? []) mergedRequired.add(r);
      } else {
        mergedProperties = { ...mergedProperties, ...(entry.properties ?? {}) };
        for (const r of entry.required ?? []) mergedRequired.add(r);
      }
    }
    if (resolvedAny) {
      return {
        type: "object",
        properties: mergedProperties,
        required: Array.from(mergedRequired).sort(),
      };
    }
    return schema;
  }

  return schema;
}

function propertiesFromSchema(schema: any): {
  props: Record<string, any>;
  required: Set<string>;
} {
  const props = schema?.properties ?? {};
  const required = new Set<string>(schema?.required ?? []);
  return { props, required };
}

export function rawSchemaFragment(op: any, operation: SchemaOperation): any {
  if (operation === "create" || operation === "update") {
    return op?.requestBody?.content?.["application/json"]?.schema ?? {};
  }
  if (operation === "get") {
    return op?.responses?.["200"]?.content?.["application/json"]?.schema ?? {};
  }
  if (operation === "list") {
    const parameters = Array.isArray(op?.parameters) ? op.parameters : [];
    return { parameters: parameters.filter((p: any) => p?.in === "query") };
  }
  return {}; // delete takes no body
}

export function extractFields(op: any, operation: SchemaOperation): any[] {
  if (operation === "create" || operation === "update") {
    const schema = op?.requestBody?.content?.["application/json"]?.schema ?? {};
    const { props, required } = propertiesFromSchema(schema);
    return Object.entries(props).map(([name, prop]: [string, any]) => {
      const entry: any = {
        field: name,
        type: prop?.type ?? "object",
        required: required.has(name),
      };
      for (const key of ["enum", "example", "description"]) {
        if (prop && key in prop) entry[key] = prop[key];
      }
      return entry;
    });
  }
  if (operation === "get") {
    const schema =
      op?.responses?.["200"]?.content?.["application/json"]?.schema ?? {};
    const { props } = propertiesFromSchema(schema);
    return Object.entries(props).map(([name, prop]: [string, any]) => {
      const entry: any = { field: name, type: prop?.type ?? "object" };
      for (const key of ["enum", "example", "description"]) {
        if (prop && key in prop) entry[key] = prop[key];
      }
      return entry;
    });
  }
  if (operation === "list") {
    const parameters = Array.isArray(op?.parameters) ? op.parameters : [];
    return parameters
      .filter((param: any) => param?.in === "query")
      .map((param: any) => {
        const entry: any = {
          field: param.name,
          type: param?.schema?.type ?? "string",
          required: param.required ?? false,
        };
        for (const key of ["description", "example"]) {
          if (key in param) entry[key] = param[key];
        }
        return entry;
      });
  }
  return []; // delete takes no body
}

/**
 * Merge path-item-level 'parameters' (a sibling of get/post/etc, applying to
 * all methods on that path) with operation-level 'parameters'. Operation-level
 * wins on a name+location collision, per the OpenAPI spec (more specific
 * overrides shared).
 */
export function mergePathItemParameters(pathItem: any, op: any): any[] {
  const merged = new Map<string, any>();
  for (const param of pathItem?.parameters ?? []) {
    merged.set(`${param?.name}:${param?.in}`, param);
  }
  for (const param of op?.parameters ?? []) {
    merged.set(`${param?.name}:${param?.in}`, param);
  }
  return Array.from(merged.values());
}

/**
 * Return a copy of `op` with its request-body ('create'/'update') or
 * 200-response ('get') schema replaced by its $ref/allOf-$ref resolved form,
 * so downstream extractFields/isComposedSchema/rawSchemaFragment all see the
 * resolved schema uniformly, whether verbose or simplified mode is requested.
 */
export function withResolvedSchema(
  op: any,
  operation: SchemaOperation,
  spec: any,
): any {
  const raw = rawSchemaFragment(op, operation);
  if (!raw || typeof raw !== "object") return op;
  const resolved = resolveSchemaRef(raw, spec);
  if (resolved === raw) return op;

  if (operation === "create" || operation === "update") {
    return {
      ...op,
      requestBody: {
        ...op.requestBody,
        content: {
          ...op.requestBody?.content,
          "application/json": {
            ...op.requestBody?.content?.["application/json"],
            schema: resolved,
          },
        },
      },
    };
  }
  // operation === "get"
  return {
    ...op,
    responses: {
      ...op.responses,
      "200": {
        ...op.responses?.["200"],
        content: {
          ...op.responses?.["200"]?.content,
          "application/json": {
            ...op.responses?.["200"]?.content?.["application/json"],
            schema: resolved,
          },
        },
      },
    },
  };
}

export function operationMethod(operation: SchemaOperation): string {
  return OPERATION_METHOD[operation];
}

export function availableMethods(pathItem: Record<string, any>): string[] {
  return Object.keys(pathItem)
    .filter((k) => HTTP_METHODS.has(k))
    .sort();
}

// -----------------------------------------------------------------------
// Node-descriptor (chart/descriptors) resolution
// -----------------------------------------------------------------------

export function findNodeDescriptor(
  descriptors: any[],
  nodeType: string,
): any | undefined {
  return descriptors.find((d) => d?.type === nodeType);
}

export function knownNodeTypes(descriptors: any[]): string[] {
  return Array.from(
    new Set(descriptors.map((d) => d?.type).filter(Boolean)),
  ).sort();
}

/**
 * Flatten a chart/descriptors node-type's raw fields[] (UI-editor field
 * metadata: key/type/label/defaultValue/condition/params.options) into the
 * same {field, type, ...} shape describe_resource_schema already returns for
 * OpenAPI-derived fields, so callers don't need two different result shapes.
 */
export function simplifyDescriptorFields(fields: any[]): any[] {
  return fields.map((descriptorField) => {
    const entry: any = {
      field: descriptorField?.key,
      type: descriptorField?.type,
    };
    for (const key of ["label", "description", "condition"]) {
      if (descriptorField && key in descriptorField)
        entry[key] = descriptorField[key];
    }
    if (descriptorField && "defaultValue" in descriptorField) {
      entry.default = descriptorField.defaultValue;
    }
    const params = descriptorField?.params ?? {};
    if ("required" in params) entry.required = params.required;
    if ("options" in params) {
      entry.enum = (params.options ?? [])
        .filter((option: any) => option && typeof option === "object")
        .map((option: any) => option.value);
    }
    return entry;
  });
}
