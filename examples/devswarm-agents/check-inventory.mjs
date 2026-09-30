// Read-only consumer tooling: compare the recorded scope with a local DevSwarm checkout.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const inventory=JSON.parse(await readFile(new URL('./inventory.json',import.meta.url),'utf8'));
const checkout=process.argv[2];
assert.ok(checkout,'Usage: node examples/devswarm-agents/check-inventory.mjs /path/to/devswarm');
const source=await readFile(resolve(checkout,inventory.source.enumPath),'utf8');
const current=[...source.matchAll(/^  (\w+) = "([^"]+)",/gm)].map(([,name,value])=>`${name}=${value}`).sort();
assert.ok(current.length,'No enum entries found; inspect the upstream source format');
const recorded=inventory.agents.map(a=>`${a.enum}=${a.value}`).sort();
assert.deepEqual(current,recorded,'DevSwarm agent scope changed; refresh the inventory and verify added agents');
assert.equal(new Set(recorded).size,recorded.length);
console.log(`Scope matches: ${recorded.length} enum values, ${new Set(inventory.agents.map(a=>a.family)).size} families`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(inventory.agents,a=>a.status)).map(([status,agents])=>[status,agents.length])),null,2));
