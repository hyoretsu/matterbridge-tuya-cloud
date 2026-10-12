export interface Logger { debug(message: string, ...args: unknown[]): void; warn(message: string, ...args: unknown[]): void; info(message: string, ...args: unknown[]): void; }
import {
  AuthenticationError,
  RateLimitError,
  UnsupportedOperationError,
} from "../errors/index.js";
import axios, { AxiosRequestConfig } from "axios";
import { Session } from "./session.js";
import {
  DeviceQueryPayload,
  DeviceState,
  DiscoveryPayload,
  TuyaApiMethod,
  TuyaApiPayload,
  TuyaDevice,
  TuyaRequestHeader,
  TuyaResponseHeader,
} from "./response.js";
import { TuyaPlatform } from "./platform.js";

import { DeviceOfflineError } from "../errors/DeviceOfflineError.js";
import { URLSearchParams } from "url";

// Requests to the Tuya Web API had no timeout, so on hosts where the request
// stalls at the network layer (e.g. a broken IPv6 route to px1.tuya*.com that
// never fails over to IPv4) the call hangs indefinitely with no error and no
// log output, silently freezing token refresh, discovery and device control.
const REQUEST_TIMEOUT_MS = 15000;

export class TuyaWebApi {
  private session: Session | undefined;
  private closed = false;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private requests = new Set<AbortController>();
  private retryCount = 0;

  public shutdown(): void {
    this.closed = true;
    clearTimeout(this.refreshTimer);
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }

  private async request<T>(config: AxiosRequestConfig): Promise<{ data: T }> {
    if (this.closed) throw new Error("Tuya client is shut down");
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const result = await this.transport<T>({ ...config, signal: controller.signal, timeout: REQUEST_TIMEOUT_MS });
      if (this.closed) throw new Error("Tuya client is shut down");
      return result;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) throw new RateLimitError("HTTP rate limit");
      throw error;
    } finally { this.requests.delete(controller); }
  }

  private wait(milliseconds: number): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Tuya client is shut down"));
    const controller = new AbortController();
    this.requests.add(controller);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(controller);
        resolve();
      }, milliseconds);
      controller.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        this.requests.delete(controller);
        reject(new Error("Tuya client is shut down"));
      }, { once: true });
    });
  }

  private scheduleRefresh(milliseconds: number): void {
    clearTimeout(this.refreshTimer);
    if (this.closed) return;
    this.refreshTimer = setTimeout(() => {
      void this.getOrRefreshToken().catch(error => {
        if (this.closed) return;
        this.log?.warn(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
        this.retryCount++;
        this.scheduleRefresh(Math.min(300_000, 5_000 * 2 ** Math.min(this.retryCount, 6)));
      });
    }, Math.max(1000, milliseconds));
    this.refreshTimer.unref?.();
  }
  private authBaseUrl = "https://px1.tuyaeu.com";

  constructor(
    private username: string,
    private password: string,
    private countryCode: string,
    private tuyaPlatform: TuyaPlatform = "tuya",
    private log?: Logger,
    private transport: typeof axios = axios,
  ) {}

  public async getAllDeviceStates(): Promise<TuyaDevice[] | undefined> {
    return this.discoverDevices();
  }

  public async discoverDevices(): Promise<TuyaDevice[] | undefined> {
    if (!this.session?.hasValidToken()) {
      throw new Error("No valid token");
    }

    const { data } = await this.sendRequest<DiscoveryPayload>(
      "/homeassistant/skill",
      {
        header: {
          name: "Discovery",
          namespace: "discovery",
          payloadVersion: 1,
        },
        payload: {
          accessToken: this.session.accessToken,
        },
      },
      "GET",
    );

    if (data?.header && data.header.code === "SUCCESS") {
      if (!Array.isArray(data.payload?.devices) || data.payload.devices.some(device =>
        !device || typeof device.id !== "string" || !device.id || typeof device.name !== "string" || typeof device.dev_type !== "string" || !device.data || typeof device.data !== "object" || Array.isArray(device.data))) {
        throw new Error("Malformed discovery response");
      }
      return data.payload.devices;
    } else {
      if (data?.header && data.header.code === "FrequentlyInvoke") {
        throw new RateLimitError("Requesting too quickly.", data.header.msg);
      } else {
        throw new Error(`No valid response from API: ${JSON.stringify(data)}`);
      }
    }
  }

  public async getDeviceState(deviceId: string): Promise<DeviceState> {
    if (!this.session?.hasValidToken()) {
      throw new Error("No valid token");
    }

    const { data } = await this.sendRequest<DeviceQueryPayload>(
      "/homeassistant/skill",
      {
        header: {
          name: "QueryDevice",
          namespace: "query",
          payloadVersion: 1,
        },
        payload: {
          accessToken: this.session.accessToken,
          devId: deviceId,
          value: 1,
        },
      },
      "GET",
    );

    if (data?.header && data.header.code === "SUCCESS") {
      if (!data.payload?.data || typeof data.payload.data !== "object" || Array.isArray(data.payload.data)) throw new Error("Malformed query response");
      return data.payload.data;
    } else {
      if (data?.header && data.header.code === "FrequentlyInvoke") {
        throw new RateLimitError("Requesting too quickly.", data.header.msg);
      } else {
        throw new Error(`No valid response from API: ${JSON.stringify(data)}`);
      }
    }
  }

  public async setDeviceState<Method extends TuyaApiMethod>(
    deviceId: string,
    method: Method,
    payload: TuyaApiPayload<Method>,
  ): Promise<void> {
    if (!this.session?.hasValidToken()) {
      throw new Error("No valid token");
    }

    const { data } = await this.sendRequest(
      "/homeassistant/skill",
      {
        header: {
          name: method,
          namespace: "control",
          payloadVersion: 1,
        },
        payload: {
          ...payload,
          accessToken: this.session?.accessToken,
          devId: deviceId,
        },
      },
      "POST",
    );

    if (data?.header && data.header.code === "SUCCESS") {
      return;
    } else if (data?.header && data.header.code === "FrequentlyInvoke") {
      throw new RateLimitError("Requesting too quickly.", data.header.msg);
    } else if (data?.header && data.header.code === "UnsupportedOperation") {
      throw new UnsupportedOperationError(
        "Unsupported Operation",
        "The action you tried to perform is not valid for the current device. Please disable it.",
      );
    } else if (data?.header && data.header.code === "TargetOffline") {
      throw new DeviceOfflineError();
    } else {
      throw new Error(`Invalid payload in response: ${JSON.stringify(data)}`);
    }
  }

  public async getOrRefreshToken(retryingAfterError = false): Promise<Session> {
    let data: Record<string, unknown> & { header: TuyaResponseHeader };

    if (!this.session?.hasToken()) {
      this.log?.debug("Requesting new token");
      // No token, lets get a token from the Tuya Web API
      if (!this.username) {
        throw new AuthenticationError("No username configured");
      }
      if (!this.password) {
        throw new AuthenticationError("No password configured");
      }
      if (!this.countryCode) {
        throw new AuthenticationError("No country code configured");
      }

      const formData = new URLSearchParams({
        userName: this.username,
        password: this.password,
        countryCode: this.countryCode,
        bizType: this.tuyaPlatform,
        from: "tuya",
      }).toString();
      const contentLength = formData.length;

      data = (
        await this.request<Record<string, unknown> & { header: TuyaResponseHeader }>({
          headers: {
            "Content-Length": `${contentLength}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          url: "/homeassistant/auth.do",
          baseURL: this.authBaseUrl,
          data: formData,
          method: "POST",
          timeout: REQUEST_TIMEOUT_MS,
        })
      ).data;
    } else {
      this.log?.debug("Refreshing token");
      // Refresh token
      data = (
        await this.sendRequest(
          "/homeassistant/access.do?grant_type=refresh_token&refresh_token=" +
            encodeURIComponent(this.session.refreshToken),
          {},
          "GET",
        )
      ).data;
    }

    if (!data || typeof data !== "object") throw new AuthenticationError("Malformed authentication response");
    if (data.responseStatus === "error") {
      const throttle = typeof data.errorMsg === "string" ? /you cannot auth exceed once in (\d+) seconds/.exec(data.errorMsg) : null;
      if (throttle && !retryingAfterError) {
        const seconds = Math.min(300, Number(throttle[1])) + 5;
        this.log?.warn(`Cannot acquire token; retrying in ${seconds} seconds.`);
        await this.wait(seconds * 1000);
        return this.getOrRefreshToken(true);
      }
      throw new AuthenticationError(
        data.errorMsg?.toString() ?? JSON.stringify(data),
      );
    }

    if (!Session.isValidSessionData(data)) {
      throw new AuthenticationError(
        "Invalid session data",
      );
    }

    if (!this.session?.hasToken()) {
      this.session = new Session(
        data.access_token,
        data.refresh_token,
        data.expires_in,
        data.access_token.substring(0, 2),
      );
    } else {
      this.session.resetToken(
        data.access_token,
        data.refresh_token,
        data.expires_in,
      );
    }

    this.retryCount = 0;
    this.scheduleRefresh((data.expires_in > 3600 ? data.expires_in - 3600 : data.expires_in * 0.8) * 1000);

    return this.session;
  }

  /*
   * --------------------------------------
   * HTTP methods
   */

  public async sendRequest<T = Record<string, unknown>>(
    url: AxiosRequestConfig["url"],
    data: { header?: TuyaRequestHeader } & Record<string, unknown>,
    method: AxiosRequestConfig["method"],
  ): Promise<{ data: T & { header: TuyaResponseHeader } }> {
    this.log?.debug(
      "Sending HTTP %s request to %s - Header: %s.",
      method,
      url?.replace(/([?&]refresh_token=)[^&]*/g, "$1[redacted]"),
      JSON.stringify(data.header),
    );
    const response = await this.request({
      baseURL: this.session?.areaBaseUrl,
      url,
      data,
      method,
      timeout: REQUEST_TIMEOUT_MS,
    });

    return { data: response.data as T & { header: TuyaResponseHeader } };
  }
}
