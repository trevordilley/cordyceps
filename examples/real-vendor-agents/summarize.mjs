// Compact committed receipts; the verifier output retains complete native requests/responses.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [source,destination]=process.argv.slice(2);
if(!source||!destination)throw new Error('Usage: node summarize.mjs full.json receipt.json');
const bytes=await readFile(source),evidence=JSON.parse(bytes);
const hash=value=>createHash('sha256').update(value).digest('hex');
const cases=evidence.cases.map(c=>({
  harness:c.harness,scenario:c.scenario,passed:c.passed,cleanedUp:c.cleanedUp,
  version:c.version,process:c.process,prompt:c.prompt,marker:c.marker,fixtureToken:c.fixtureToken,
  assertions:c.assertions,error:c.error,failures:c.failures,
  requests:(c.requests||[]).map(r=>({id:r.id,method:r.raw.method,path:r.raw.path,model:r.model,stream:r.stream,
    bodySha256:hash(r.raw.body),bodyBytes:Buffer.byteLength(r.raw.body),
    promptPresent:r.text.includes(c.prompt),fixtureTokenPresent:r.raw.body.includes(c.fixtureToken),
    toolResults:r.toolResults,
    tools:r.tools.filter(t=>['Read','read','read_file','submit_reminder_decision'].includes(t.name)),
  })),
  responses:(c.responses||[]).map(r=>({requestId:r.requestId,status:r.status,outcome:r.outcome,headers:r.headers,
    wireSha256:hash(r.chunks.map(c=>typeof c==='string'?c:Buffer.from(c)).join(''))})),
}));
await writeFile(destination,JSON.stringify({...evidence,cases,fullEvidence:{path:source,sha256:hash(bytes),bytes:bytes.length}},null,2)+'\n');
console.log(cases.map(c=>`${c.harness} ${c.scenario}: ${c.passed?'PASS':'FAIL'}`).join('\n'));
