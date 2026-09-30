// Read-only consumer audit. This does not install, discover, or launch agents.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const inventory = JSON.parse(await readFile(new URL('./inventory.json', import.meta.url), 'utf8'));
const [superset, orca] = process.argv.slice(2);
assert.ok(superset && orca, 'Usage: node examples/orchestrator-agents/check-inventory.mjs /path/to/superset /path/to/orca');
for (const source of inventory.sources.filter(s => s.repository)) {
  const text = await readFile(resolve(source.id === 'superset' ? superset : orca, source.path), 'utf8');
  const pattern = source.id === 'superset' ? /\bid: "([a-z0-9-]+)"/g : /\| '([^']+)'/g;
  const ids = [...text.matchAll(pattern)].map(match => match[1]).sort();
  assert.ok(ids.length, 'Upstream format changed; inspect source instead of accepting an empty inventory');
  assert.deepEqual(ids, [...source.entries].sort(), `${source.id} roster drifted`);
  const mapped = inventory.agents.flatMap(agent => agent.sources.filter(s => s.orchestrator === source.id).map(s => s.id)).sort();
  assert.deepEqual(mapped, ids, `${source.id} entries need exact, unique outcome mappings`);
  console.log(`${source.id}: ${ids.length} source entries accounted for`);
}
assert.equal(new Set(inventory.agents.map(a => a.id)).size, inventory.agents.length);
for (const agent of inventory.agents) {
  assert.notEqual(agent.status, 'pending', `${agent.id} still needs a verified outcome or exclusion`);
  assert.ok(agent.evidence?.length, `${agent.id} lacks evidence`);
  for (const path of agent.evidence) await readFile(new URL('../../' + path, import.meta.url));
  if (agent.status.startsWith('verified')) {
    assert.ok(agent.recipe, `${agent.id} lacks an injection recipe`);
    const recipe = JSON.parse(await readFile(new URL(`../../harnesses/${agent.recipe}.json`, import.meta.url), 'utf8'));
    assert.equal(recipe.id, agent.recipe);
  } else assert.equal(agent.recipe, undefined, `${agent.id} must not offer an unverified recipe`);
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(inventory.agents, a => a.status)).map(([key, agents]) => [key, agents.length]))));
