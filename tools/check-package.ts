import { mkdtemp, readdir, readFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const temporary = await mkdtemp(join(tmpdir(), "matterbridge-tuya-cloud-package-"));
async function run(command: string[], cwd?: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  assert.equal(code, 0, `${command[0]} failed: ${error}`);
  return output;
}
try {
  await run(["bun", "pm", "pack", "--ignore-scripts", "--destination", temporary]);
  const tarball = (await readdir(temporary)).find(file => file.endsWith(".tgz"))!;
  const files = (await run(["tar", "-tzf", join(temporary, tarball)])).split("\n");
  for (const file of ["package/package.json", "package/dist/src/index.js", "package/matterbridge-tuya-cloud.config.json", "package/matterbridge-tuya-cloud.schema.json"]) assert(files.includes(file), `Package missing ${file}`);
  for (const file of files) assert(!/node_modules|\.sdk|\.test\.|\/tests\/|\/src\/accessories\//.test(file), `Unwanted package file ${file}`);
  await run(["tar", "-xzf", join(temporary, tarball), "-C", temporary]);
  const packaged = join(temporary, "package");
  const manifest = JSON.parse(await readFile(join(packaged, "package.json"), "utf8"));
  assert.equal(manifest.name, "matterbridge-tuya-cloud");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.matterbridge, ">=3.10.13");
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies })) assert(!/^(matterbridge|homebridge|@matter\/)/.test(name), `Host dependency bundled: ${name}`);
  await mkdir(join(packaged, "node_modules"));
  for (const name of ["qrcode", "matterbridge"]) await symlink(resolve("node_modules", name), join(packaged, "node_modules", name));
  await run(["bun", "--eval", 'const plugin = await import("./dist/src/index.js"); if (typeof plugin.default !== "function") throw new Error("ESM factory missing");'], packaged);
  console.log(`Package verified: ${files.filter(Boolean).length} files; clean ESM factory loads with host SDK.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
