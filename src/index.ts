import type { PlatformConfig, PlatformMatterbridge } from "matterbridge";
import type { AnsiLogger } from "matterbridge/logger";
import { TuyaPlatform } from "./platform.js";

export default function createPlatform(host: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): TuyaPlatform {
  return new TuyaPlatform(host, log, config);
}
