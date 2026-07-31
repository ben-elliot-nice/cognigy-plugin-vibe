import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";
import { _clearSchemaIntrospectionCache } from "../tools/schemaIntrospection.js";

const FLOW_ID = "60d5ec49f1a2c8b1a4e0f002";

const FIXTURE_SPEC = {
  openapi: "3.0.0",
  paths: {
    "/v2.0/lexicons": {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: {
                    type: "string",
                    example: "EU countries",
                    description: "The name of the lexicon",
                  },
                  projectId: {
                    type: "string",
                    description: "The project id",
                  },
                },
              },
            },
          },
        },
      },
      get: {
        parameters: [
          {
            in: "header",
            name: "Accept",
            required: false,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "projectId",
            required: false,
            description: "Project id filter",
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "limit",
            required: false,
            example: 100,
            schema: { type: "integer" },
          },
        ],
      },
    },
    "/v2.0/lexicons/{lexiconId}": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    _id: { type: "string" },
                    name: { type: "string", description: "The name" },
                  },
                },
              },
            },
          },
        },
      },
      patch: {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
              },
            },
          },
        },
      },
      delete: {},
    },
    "/v2.0/onlygettable": { get: { parameters: [] } },
  },
};

const FIXTURE_DESCRIPTORS_RESPONSE = {
  items: [
    {
      type: "say",
      fields: [
        {
          type: "cognigyTextArray",
          key: "say",
          label: "Say",
          defaultValue: { text: [] },
        },
        {
          type: "select",
          key: "handoverOutput",
          label: "Handover Output",
          description: "Who sees this message",
          defaultValue: "userAndAgent",
          params: {
            required: true,
            options: [
              { label: "User and agent", value: "userAndAgent" },
              { label: "User only", value: "userOnly" },
            ],
          },
        },
      ],
    },
    {
      type: "if",
      fields: [{ type: "condition", key: "condition", label: "Condition" }],
    },
  ],
  total: 2,
  nextCursor: null,
};

describe("describe_resource_schema", () => {
  let api: jest.Mocked<CognigyApiClient>;
  let h: ToolHandlers;

  beforeEach(() => {
    _clearSchemaIntrospectionCache();
    api = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      put: jest.fn(),
      uploadFile: jest.fn(),
    } as any;
    h = new ToolHandlers(
      api,
      "https://endpoint-trial.cognigy.ai",
      "",
      "https://static-trial.cognigy.ai",
    );
  });

  describe("schema resolution for a known resource", () => {
    it("resolves create fields via the live OpenAPI spec, normalizing singular resourceType", async () => {
      api.get.mockResolvedValueOnce(FIXTURE_SPEC as any);

      const result = await h.handleToolCall("describe_resource_schema", {
        resourceType: "lexicon",
        operation: "create",
      });

      expect(api.get).toHaveBeenCalledWith("/openapi/openapi-viewer.json");
      expect(result.path).toBe("/v2.0/lexicons");
      expect(result.method).toBe("post");
      expect(result.resource_type).toBe("lexicons");
      const byName = Object.fromEntries(
        result.fields.map((f: any) => [f.field, f]),
      );
      expect(byName.name.required).toBe(true);
      expect(byName.name.example).toBe("EU countries");
      expect(byName.projectId.required).toBe(false);
    });

    it("resolves update (PATCH) fields", async () => {
      api.get.mockResolvedValueOnce(FIXTURE_SPEC as any);

      const result = await h.handleToolCall("describe_resource_schema", {
        resourceType: "lexicons",
        operation: "update",
      });

      expect(result.path).toBe("/v2.0/lexicons/{lexiconId}");
      expect(result.method).toBe("patch");
      const names = result.fields.map((f: any) => f.field);
      expect(names).toEqual(["name"]);
    });

    it("resolves get fields from the response schema", async () => {
      api.get.mockResolvedValueOnce(FIXTURE_SPEC as any);

      const result = await h.handleToolCall("describe_resource_schema", {
        resourceType: "lexicons",
        operation: "get",
      });

      const names = new Set(result.fields.map((f: any) => f.field));
      expect(names).toEqual(new Set(["_id", "name"]));
    });

    it("returns verbose raw_schema instead of simplified fields", async () => {
      api.get.mockResolvedValueOnce(FIXTURE_SPEC as any);

      const result = await h.handleToolCall("describe_resource_schema", {
        resourceType: "lexicons",
        operation: "create",
        verbose: true,
      });

      expect(result.fields).toBeUndefined();
      expect(result.raw_schema.properties.name.example).toBe("EU countries");
    });

    it("lists known_resource_types when nothing matches", async () => {
      api.get.mockResolvedValueOnce(FIXTURE_SPEC as any);

      const result = await h.handleToolCall("describe_resource_schema", {
        resourceType: "nonexistent",
        operation: "create",
      });

      expect(result.error).toMatch(/No OpenAPI path found/);
      expect(result.known_resource_types).toContain("lexicons");
    });

    it("reports operation not available with available_methods", async () => {
      api.get.mockResolvedValueOnce(FIXTURE_SPEC as any);

      const result = await h.handleToolCall("describe_resource_schema", {
        resourceType: "onlygettable",
        operation: "create",
      });

      expect(result.error).toMatch(/not available/);
      expect(result.available_methods).toEqual(["get"]);
    });
  });

  describe("cache behavior", () => {
    it("a cache hit avoids a second OpenAPI spec fetch", async () => {
      api.get.mockResolvedValue(FIXTURE_SPEC as any);

      await h.handleToolCall("describe_resource_schema", {
        resourceType: "lexicons",
        operation: "create",
      });
      await h.handleToolCall("describe_resource_schema", {
        resourceType: "lexicons",
        operation: "update",
      });

      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it("node-descriptor lookups cache across calls too, keyed per flowId", async () => {
      api.get.mockResolvedValue(FIXTURE_DESCRIPTORS_RESPONSE as any);

      await h.handleToolCall("describe_resource_schema", {
        resourceType: "node",
        nodeType: "say",
        flowId: FLOW_ID,
      });
      await h.handleToolCall("describe_resource_schema", {
        resourceType: "node",
        nodeType: "if",
        flowId: FLOW_ID,
      });

      expect(api.get).toHaveBeenCalledTimes(1);
      expect(api.get).toHaveBeenCalledWith(
        `/v2.0/flows/${FLOW_ID}/chart/descriptors`,
      );
    });
  });

  describe("graceful error when the spec can't be fetched", () => {
    it("propagates a clean error when the OpenAPI fetch fails, without crashing the handler", async () => {
      api.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(
        h.handleToolCall("describe_resource_schema", {
          resourceType: "lexicons",
          operation: "create",
        }),
      ).rejects.toThrow("ECONNREFUSED");
    });

    it("propagates a clean error when the chart/descriptors fetch fails", async () => {
      api.get.mockRejectedValueOnce(new Error("boom"));

      await expect(
        h.handleToolCall("describe_resource_schema", {
          resourceType: "node",
          nodeType: "say",
          flowId: FLOW_ID,
        }),
      ).rejects.toThrow("boom");
    });
  });

  describe("node_type / flowId lookups", () => {
    it("returns simplified fields for a known node type", async () => {
      api.get.mockResolvedValueOnce(FIXTURE_DESCRIPTORS_RESPONSE as any);

      const result = await h.handleToolCall("describe_resource_schema", {
        resourceType: "node",
        nodeType: "say",
        flowId: FLOW_ID,
      });

      expect(result.resource_type).toBe("node");
      expect(result.node_type).toBe("say");
      expect(result.flow_id).toBe(FLOW_ID);
      const byField = Object.fromEntries(
        result.fields.map((f: any) => [f.field, f]),
      );
      expect(new Set(Object.keys(byField))).toEqual(
        new Set(["say", "handoverOutput"]),
      );
      expect(byField.handoverOutput.required).toBe(true);
      expect(byField.handoverOutput.enum).toEqual(["userAndAgent", "userOnly"]);
      expect(byField.handoverOutput.default).toBe("userAndAgent");
    });

    it("returns raw_fields when verbose", async () => {
      api.get.mockResolvedValueOnce(FIXTURE_DESCRIPTORS_RESPONSE as any);

      const result = await h.handleToolCall("describe_resource_schema", {
        resourceType: "node",
        nodeType: "if",
        flowId: FLOW_ID,
        verbose: true,
      });

      expect(result.fields).toBeUndefined();
      expect(result.raw_fields).toEqual([
        { type: "condition", key: "condition", label: "Condition" },
      ]);
    });

    it("lists known_node_types for an unknown node type", async () => {
      api.get.mockResolvedValueOnce(FIXTURE_DESCRIPTORS_RESPONSE as any);

      const result = await h.handleToolCall("describe_resource_schema", {
        resourceType: "node",
        nodeType: "doesNotExist",
        flowId: FLOW_ID,
      });

      expect(result.error).toMatch(/No node descriptor found/);
      expect(result.known_node_types).toEqual(["if", "say"]);
    });

    it("rejects nodeType without flowId at the schema validation layer", async () => {
      await expect(
        h.handleToolCall("describe_resource_schema", {
          resourceType: "node",
          nodeType: "say",
        }),
      ).rejects.toThrow();
      expect(api.get).not.toHaveBeenCalled();
    });

    it("rejects missing operation when nodeType is not set", async () => {
      await expect(
        h.handleToolCall("describe_resource_schema", {
          resourceType: "lexicons",
        }),
      ).rejects.toThrow();
    });
  });
});
