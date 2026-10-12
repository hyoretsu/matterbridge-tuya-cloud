import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sdk = resolve(process.argv[2] ?? ".sdk/node_modules/matterbridge");
const manifest = JSON.parse(await readFile(resolve(sdk, "package.json"), "utf8"));
if (manifest.name !== "matterbridge" || manifest.version !== "3.10.13") throw new Error("Development SDK must be Matterbridge 3.10.13");
const host = await import(pathToFileURL(resolve(sdk, "dist/export.js")).href);
const matter = await import(pathToFileURL(resolve(sdk, "dist/matter/export.js")).href);
const probe = new host.MatterbridgeEndpoint(host.onOffPlugInUnit, { id: "sdk-check" });
if (!(probe instanceof matter.Endpoint)) throw new Error("SDK has multiple Matter versions. Install tools/sdk.package.json in .sdk with its Matter overrides.");
await mkdir("node_modules", { recursive: true });
await rm("node_modules/matterbridge", { recursive: true, force: true });
await symlink(sdk, "node_modules/matterbridge", "dir");
console.log(`Linked Matterbridge ${manifest.version} from ${sdk}`);
