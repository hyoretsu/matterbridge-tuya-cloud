import { rm } from "node:fs/promises";

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
const result = Bun.spawn(["bun", "node_modules/typescript/bin/tsc", "--project", "tsconfig.json"], { stdout: "inherit", stderr: "inherit" });
process.exitCode = await result.exited;
