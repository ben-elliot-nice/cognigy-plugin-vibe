import { ReadStream } from "fs";
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import FormData from "form-data";
import { logger } from "../utils/logger.js";

export interface CognigyApiClientConfig {
  baseUrl: string;
  apiKey: string;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
// Cap on any delay we honour from a server-supplied Retry-After header — a
// misbehaving/huge value shouldn't stall the tool call indefinitely.
const MAX_RETRY_AFTER_MS = 30000;

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ERR_NETWORK",
]);

// Methods that are safe to blindly re-send: repeating them has no side effect
// beyond what the first (possibly lost) response already caused.
const IDEMPOTENT_METHODS = new Set(["get", "put", "delete", "patch"]);

function isIdempotentMethod(method?: string): boolean {
  return IDEMPOTENT_METHODS.has((method ?? "get").toLowerCase());
}

/**
 * Whether a failed request is safe to retry.
 *
 * - 429 (rate-limited) is retried regardless of method: the request was
 *   rejected *before* any processing, so re-sending it — including a POST —
 *   cannot create a duplicate resource.
 * - 5xx is retried only for idempotent methods (GET/PUT/DELETE/PATCH). A 5xx
 *   on a POST is the dangerous case: the response can be lost/timed-out
 *   *after* the write already committed on the server, so blindly retrying
 *   a POST-create would create a duplicate resource. We deliberately do not
 *   retry those.
 * - Network-level errors (no response at all) carry the same ambiguity as a
 *   5xx — we can't tell whether the request reached the server — so they're
 *   likewise only retried for idempotent methods.
 */
function isRetryable(error: AxiosError): boolean {
  const method = error.config?.method;
  if (error.response) {
    const status = error.response.status;
    if (status === 429) return true;
    if (status >= 500) return isIdempotentMethod(method);
    return false;
  }
  return (
    isIdempotentMethod(method) && RETRYABLE_NETWORK_CODES.has(error.code ?? "")
  );
}

/**
 * Parse a Retry-After header value into a millisecond delay. Supports both
 * forms from RFC 9110 §10.2.3: delta-seconds ("120") and an HTTP-date
 * ("Wed, 21 Oct 2026 07:28:00 GMT"). Returns null if the header is absent or
 * unparseable, in which case callers fall back to exponential backoff.
 */
function parseRetryAfterMs(headerValue: unknown): number | null {
  if (typeof headerValue !== "string" || headerValue.trim() === "") {
    return null;
  }
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds) * 1000;
  }
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function getRetryAfterMs(error: AxiosError): number | null {
  const headers = error.response?.headers as
    | Record<string, unknown>
    | undefined;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  const parsed = parseRetryAfterMs(raw);
  return parsed === null ? null : Math.min(parsed, MAX_RETRY_AFTER_MS);
}

export class CognigyApiClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(config: CognigyApiClientConfig) {
    this.apiKey = config.apiKey;
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
    });

    this.client.interceptors.request.use(
      (reqConfig) => {
        reqConfig.headers["X-API-Key"] = this.apiKey;
        logger.debug(
          `API Request: ${reqConfig.method?.toUpperCase()} ${reqConfig.url}`,
        );
        return reqConfig;
      },
      (error) => {
        logger.error("API Request Error", { error: error.message });
        return Promise.reject(error);
      },
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      async (error: AxiosError) => {
        const config = error.config as AxiosRequestConfig & {
          _retryCount?: number;
        };
        const status = error.response?.status ?? 0;

        if (config && isRetryable(error)) {
          config._retryCount = (config._retryCount ?? 0) + 1;
          if (config._retryCount <= MAX_RETRIES) {
            const retryAfterMs = getRetryAfterMs(error);
            const delay =
              retryAfterMs ??
              RETRY_BASE_MS * Math.pow(2, config._retryCount - 1);
            logger.warn(
              `Retrying request (${config._retryCount}/${MAX_RETRIES}) after ${delay}ms`,
              {
                status,
                url: config.url,
                honoredRetryAfter: retryAfterMs !== null,
              },
            );
            await new Promise((r) => setTimeout(r, delay));
            return this.client.request(config);
          }
        }

        const message = (error.response?.data as any)?.detail || error.message;
        const traceId = (error.response?.data as any)?.traceId;

        logger.error("API Response Error", {
          status: status || "N/A",
          message,
          traceId,
          url: config?.url,
        });

        return Promise.reject(this.formatError(error));
      },
    );
  }

  private formatError(error: AxiosError): Error {
    const data = error.response?.data as any;
    if (data) {
      const message = data.detail || data.title || "API request failed";
      const enhancedError = new Error(message);
      (enhancedError as any).status = data.status || error.response?.status;
      (enhancedError as any).code = data.code;
      (enhancedError as any).traceId = data.traceId;
      (enhancedError as any).details = data.details;
      return enhancedError;
    }
    return error;
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url, config);
    return response.data;
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(
      url,
      data,
      config,
    );
    return response.data;
  }

  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(url, data, config);
    return response.data;
  }

  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.patch(
      url,
      data,
      config,
    );
    return response.data;
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(url, config);
    return response.data;
  }

  async uploadFile<T = any>(
    url: string,
    fileData: Buffer | ReadStream,
    fileName: string,
    extraFields?: Record<string, string>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const form = new FormData();
    form.append("file", fileData, { filename: fileName });
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        form.append(key, value);
      }
    }
    const response: AxiosResponse<T> = await this.client.post(url, form, {
      headers: {
        ...form.getHeaders(),
        "X-API-Key": this.apiKey,
      },
      timeout: options?.timeoutMs ?? 120000,
    });
    return response.data;
  }
}
