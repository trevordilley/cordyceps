// Read-only verification of the structural observations from the installed package.
import {readFile,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const evidence=JSON.parse(await readFile(new URL('./source-evidence.json',import.meta.url),'utf8'));
const directory=dirname(await realpath(process.argv[2]||process.env.CORDYCEPS_CURSOR_BINARY||'/Users/20idemo/.local/bin/cursor-agent'));
const report={directory,files:{},markers:{}};
for(const name of Object.keys(evidence.files)){
 const bytes=await readFile(join(directory,name));
 report.files[name]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
for(const [name,marker] of Object.entries(evidence.markers)){
 const text=await readFile(join(directory,marker.file),'utf8'),index=text.indexOf(marker.needle);
 report.markers[name]={found:index>=0,byteOffset:index<0?null:Buffer.byteLength(text.slice(0,index))};
}
console.log(JSON.stringify(report,null,2));
// A changed minified symbol is a reason to inspect the new package, not a support/version failure.
