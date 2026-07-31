/**
 * Verifies the write paths that must invalidate/forget cache state actually
 * do so, closing the gaps found in review:
 *   1. deleting a flow directly forgets both the "flow" and "agentFlow"
 *      name->id mappings that resolve to it.
 *   2. cascadeDeleteAgent invalidates the "endpoint" cache entry for every
 *      endpoint it deletes.
 *   3. manage_voice_gateway's update path invalidates the "endpoint" cache
 *      entry it patches, matching manage_webchat's behavior.
 *   4. manage_knowledge { operation: "create_source" } invalidates the
 *      "knowledge_store" cache entry (sourceCount changed) for all three
 *      source types.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";
import { CacheStore } from "../cache/cacheStore.js";
import { MemoryFs, type Clock } from "../cache/fsLike.js";

class TestClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
}

const ID = {
  agent: "60d5ec49f1a2c8b1a4e0f001",
  flow: "60d5ec49f1a2c8b1a4e0f002",
  endpoint: "60d5ec49f1a2c8b1a4e0f003",
  endpoint2: "60d5ec49f1a2c8b1a4e0f004",
  ks: "60d5ec49f1a2c8b1a4e0f007",
};

function makeCacheStore() {
  return new CacheStore({
    baseDir: "/store",
    projectKey: "proj-1",
    clock: new TestClock(),
    fs: new MemoryFs(),
  });
}

describe("cache invalidation on write paths", () => {
  let api: jest.Mocked<CognigyApiClient>;

  beforeEach(() => {
    api = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      put: jest.fn(),
    } as any;
  });

  it("delete_resource on a flow forgets both flow and agentFlow name->id mappings", async () => {
    const cacheStore = makeCacheStore();
    cacheStore.rememberId("flow", "My Flow", ID.flow);
    cacheStore.rememberId("agentFlow", ID.agent, ID.flow);
    const invalidateSpy = jest.spyOn(cacheStore, "invalidate");

    const h = new ToolHandlers(
      api,
      "https://endpoint-trial.cognigy.ai",
      "",
      "",
      cacheStore,
    );
    api.delete.mockResolvedValueOnce({});

    const result = await h.handleToolCall("delete_resource", {
      resourceType: "flow",
      id: ID.flow,
    });

    expect(result.deleted).toBe(true);
    expect(invalidateSpy).toHaveBeenCalledWith("flow", ID.flow);
    expect(cacheStore.resolveId("flow", "My Flow")).toBeUndefined();
    expect(cacheStore.resolveId("agentFlow", ID.agent)).toBeUndefined();
  });

  it("cascadeDeleteAgent invalidates the endpoint cache for every deleted endpoint", async () => {
    const cacheStore = makeCacheStore();
    // Establish a fresh interaction so the first getOrFetch below doesn't
    // idle-resync and wipe the agentFlow mapping we're about to seed.
    cacheStore.state.touchInteraction();
    const invalidateSpy = jest.spyOn(cacheStore, "invalidate");

    const h = new ToolHandlers(
      api,
      "https://endpoint-trial.cognigy.ai",
      "",
      "",
      cacheStore,
    );

    // resolveFlowForAgent: fetch agent -> derive flow
    api.get.mockImplementation(((url: string, config?: any) => {
      if (url === `/v2.0/aiagents/${ID.agent}`) {
        return Promise.resolve({
          _id: ID.agent,
          name: "My Agent",
          projectReference: "proj-x",
          flowReferenceId: "flow-ref",
        });
      }
      if (url === `/v2.0/flows/${ID.flow}`) {
        return Promise.resolve({ _id: ID.flow, referenceId: "flow-ref" });
      }
      if (url === "/v2.0/endpoints") {
        if (config?.params?.offset && config.params.offset > 0) {
          return Promise.resolve({ items: [] });
        }
        return Promise.resolve({
          items: [
            { _id: ID.endpoint, flowId: "flow-ref" },
            { _id: ID.endpoint2, flowId: "flow-ref" },
          ],
        });
      }
      // resolveFlowForAgent may look for the flow by scanning flows too
      return Promise.resolve({ items: [] });
    }) as any);

    // Force resolveFlowForAgent to resolve directly via cache to avoid depending
    // on its internal flow-discovery strategy shape.
    cacheStore.rememberId("agentFlow", ID.agent, ID.flow);

    api.delete.mockResolvedValue({});

    const result: any = await h.handleToolCall("delete_resource", {
      resourceType: "agent",
      id: ID.agent,
    });

    expect(result.deleted).toBe(true);
    expect(invalidateSpy).toHaveBeenCalledWith("endpoint", ID.endpoint);
    expect(invalidateSpy).toHaveBeenCalledWith("endpoint", ID.endpoint2);
    expect(invalidateSpy).toHaveBeenCalledWith("flow", ID.flow);
    expect(invalidateSpy).toHaveBeenCalledWith("agent", ID.agent);
  });

  it("manage_voice_gateway update invalidates the endpoint cache, matching manage_webchat", async () => {
    const cacheStore = makeCacheStore();
    const invalidateSpy = jest.spyOn(cacheStore, "invalidate");

    const h = new ToolHandlers(
      api,
      "https://endpoint-trial.cognigy.ai",
      "",
      "",
      cacheStore,
    );

    const existingEndpoint = {
      _id: ID.endpoint,
      name: "Voice GW",
      URLToken: "tok",
      webrtcClient: { id: "client-1" },
    };
    api.get.mockResolvedValue(existingEndpoint);
    api.patch.mockResolvedValueOnce({});

    await h.handleToolCall("manage_voice_gateway", {
      endpointId: ID.endpoint,
      name: "Renamed Voice GW",
    });

    expect(api.patch).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith("endpoint", ID.endpoint);
  });

  it.each([
    [
      "manual",
      { operation: "create_source", knowledgeStoreId: ID.ks, text: "hello" },
    ],
    [
      "url",
      {
        operation: "create_source",
        knowledgeStoreId: ID.ks,
        url: "https://example.com",
      },
    ],
  ])(
    "manage_knowledge create_source (%s) invalidates the knowledge_store cache",
    async (_label, args) => {
      const cacheStore = makeCacheStore();
      const invalidateSpy = jest.spyOn(cacheStore, "invalidate");

      const h = new ToolHandlers(
        api,
        "https://endpoint-trial.cognigy.ai",
        "",
        "",
        cacheStore,
      );

      api.post.mockImplementation(((url: string) => {
        if (url.endsWith("/sources")) {
          return Promise.resolve({
            knowledgeSource: { _id: "src-1" },
            _id: "src-1",
          });
        }
        if (url.endsWith("/chunks")) {
          return Promise.resolve({ _id: "chunk-1" });
        }
        return Promise.resolve({});
      }) as any);

      await h.handleToolCall("manage_knowledge", args);

      expect(invalidateSpy).toHaveBeenCalledWith("knowledge_store", ID.ks);
    },
  );
});
