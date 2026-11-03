import {readFile} from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const ref = process.env.GITHUB_REF;
if (manifest.name !== 'matterbridge-tuya-cloud' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || ref !== 'refs/tags/v' + manifest.version) throw new Error('Release tag must match stable package version: v' + manifest.version);
console.log('Verified release ' + manifest.name + '@' + manifest.version);
