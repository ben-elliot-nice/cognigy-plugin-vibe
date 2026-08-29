import { describe, it, expect } from "@jest/globals";
import {
  normalizeSayConfig,
  ensureToolAnswer,
  CANONICAL_TOOL_ANSWER,
  normalizeResourceType,
  normalizeResourceTypeArg,
  inferExtensionForNodeType,
  ensureExtension,
} from "../tools/writeNormalization.js";

describe("normalizeSayConfig", () => {
  it("lifts a bare string config.text into config.say.text", () => {
    const result = normalizeSayConfig({ text: "Hello there" });
    expect(result?.text).toBeUndefined();
    expect(result?.say).toEqual({
      type: "text",
      text: ["Hello there"],
      data: "",
      linear: false,
      loop: false,
      _cognigy: {},
    });
  });

  it("lifts an array config.text into config.say.text", () => {
    const result = normalizeSayConfig({ text: ["Hi", "there"] });
    expect(result?.say.text).toEqual(["Hi", "there"]);
  });

  it("preserves sibling config keys alongside the lifted say envelope", () => {
    const result = normalizeSayConfig({
      text: "Hello",
      alternateChannel: "voice",
    });
    expect(result?.alternateChannel).toBe("voice");
    expect(result?.say.text).toEqual(["Hello"]);
  });

  it("is a no-op when config.say is already an object (correct input passes through unchanged)", () => {
    const config = {
      say: { type: "text", text: ["Already normalised"] },
    };
    expect(normalizeSayConfig(config)).toBe(config);
  });

  it("is a no-op when there is no text key to lift", () => {
    const config = { alternateChannel: "voice" };
    expect(normalizeSayConfig(config)).toBe(config);
  });

  it("passes through non-object input unchanged", () => {
    expect(normalizeSayConfig(undefined)).toBeUndefined();
    expect(normalizeSayConfig(null)).toBeNull();
  });
});

describe("ensureToolAnswer", () => {
  it("injects the canonical answer when config is empty", () => {
    expect(ensureToolAnswer({})).toEqual({ answer: CANONICAL_TOOL_ANSWER });
  });

  it("injects the canonical answer when config is missing entirely", () => {
    expect(ensureToolAnswer(undefined)).toEqual({
      answer: CANONICAL_TOOL_ANSWER,
    });
  });

  it("does not overwrite an existing answer expression (correct input passes through unchanged)", () => {
    const config = { answer: "{{JSON.stringify(input.result)}}" };
    expect(ensureToolAnswer(config)).toEqual(config);
  });

  it("preserves other config keys when injecting the default answer", () => {
    expect(ensureToolAnswer({ maxLoops: 4 })).toEqual({
      answer: CANONICAL_TOOL_ANSWER,
      maxLoops: 4,
    });
  });
});

describe("normalizeResourceType", () => {
  const listAllowed = [
    "project",
    "agent",
    "flow",
    "endpoint",
    "llm_model",
    "knowledge_store",
    "conversation",
    "extension",
    "function",
    "tool",
  ] as const;

  it("resolves the plural form to the canonical singular ('flows' -> 'flow')", () => {
    expect(normalizeResourceType("flows", listAllowed)).toBe("flow");
  });

  it("resolves 'agents' -> 'agent'", () => {
    expect(normalizeResourceType("agents", listAllowed)).toBe("agent");
  });

  it("resolves 'knowledge_stores' -> 'knowledge_store'", () => {
    expect(normalizeResourceType("knowledge_stores", listAllowed)).toBe(
      "knowledge_store",
    );
  });

  it("passes through an already-correct value unchanged", () => {
    expect(normalizeResourceType("flow", listAllowed)).toBe("flow");
  });

  it("is case-insensitive", () => {
    expect(normalizeResourceType("Flow", listAllowed)).toBe("flow");
    expect(normalizeResourceType("Flows", listAllowed)).toBe("flow");
  });

  it("leaves a genuinely unknown resource type unchanged", () => {
    expect(normalizeResourceType("widget", listAllowed)).toBe("widget");
  });
});

describe("normalizeResourceTypeArg", () => {
  const allowed = ["flow", "agent"] as const;

  it("rewrites resourceType in a shallow copy of args", () => {
    const args = { resourceType: "flows", projectId: "abc" };
    const result = normalizeResourceTypeArg(args, allowed);
    expect(result).toEqual({ resourceType: "flow", projectId: "abc" });
    expect(result).not.toBe(args);
  });

  it("returns the original args object when no normalisation is needed", () => {
    const args = { resourceType: "flow", projectId: "abc" };
    expect(normalizeResourceTypeArg(args, allowed)).toBe(args);
  });

  it("returns args unchanged when resourceType is missing or not a string", () => {
    const args = { projectId: "abc" };
    expect(normalizeResourceTypeArg(args as any, allowed)).toBe(args);
  });
});

describe("extension inference", () => {
  it("infers the extension for a known node type", () => {
    expect(inferExtensionForNodeType("say")).toBe("@cognigy/basic-nodes");
    expect(inferExtensionForNodeType("setSessionConfig")).toBe(
      "@cognigy/voicegateway2",
    );
  });

  it("returns undefined for an unknown node type", () => {
    expect(inferExtensionForNodeType("notARealNode")).toBeUndefined();
  });

  it("ensureExtension injects the extension when missing", () => {
    const body = { type: "say", mode: "append" };
    expect(ensureExtension(body)).toEqual({
      type: "say",
      mode: "append",
      extension: "@cognigy/basic-nodes",
    });
  });

  it("ensureExtension does not overwrite an already-set extension", () => {
    const body = { type: "say", extension: "@custom/extension" };
    expect(ensureExtension(body)).toBe(body);
  });

  it("ensureExtension is a no-op for an unknown type", () => {
    const body = { type: "notARealNode" };
    expect(ensureExtension(body)).toEqual({ type: "notARealNode" });
  });
});
