/**
 * Tests for CognigyApiClient's CA-bundle wiring (src/api/client.ts).
 *
 * `getCachedCaBundle` is mocked so we can assert the resolved `ca` value
 * actually reaches the constructed `https.Agent`, without touching the real
 * filesystem or the process-level cache in src/api/caBundle.ts.
 */
import { describe, it, expect, jest } from "@jest/globals";

const getCachedCaBundle = jest.fn();

jest.unstable_mockModule("../api/caBundle.js", () => ({
  getCachedCaBundle,
}));

const { CognigyApiClient } = await import("../api/client.js");

function getHttpsAgentOptions(client: InstanceType<typeof CognigyApiClient>) {
  // The axios instance and its httpsAgent are private; reach in for the
  // purpose of this test only.
  const axiosInstance = (client as any).client;
  return axiosInstance.defaults.httpsAgent.options;
}

describe("CognigyApiClient TLS trust-store wiring", () => {
  it("passes the resolved CA bundle through to the https.Agent", () => {
    const fakeCa = [
      "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
    ];
    getCachedCaBundle.mockReturnValue({
      ca: fakeCa,
      source: "env:NODE_EXTRA_CA_CERTS",
    });

    const client = new CognigyApiClient({
      baseUrl: "https://api-trial.cognigy.ai",
      apiKey: "test-key",
    });

    expect(getHttpsAgentOptions(client).ca).toEqual(fakeCa);
  });

  it("leaves the https.Agent's ca unset when no bundle is resolved", () => {
    getCachedCaBundle.mockReturnValue({
      ca: undefined,
      source: "node-default",
    });

    const client = new CognigyApiClient({
      baseUrl: "https://api-trial.cognigy.ai",
      apiKey: "test-key",
    });

    expect(getHttpsAgentOptions(client).ca).toBeUndefined();
  });
});
