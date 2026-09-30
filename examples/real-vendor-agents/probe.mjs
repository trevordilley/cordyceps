import { isolated } from './isolation.mjs';
import { writeFile } from 'node:fs/promises';
const root=process.env.CORDYCEPS_VENDOR_BIN_DIR||'/tmp/cordyceps-vendor-investigation';
export const binaries={ante:root+'/ante/ante',fx:root+'/fx/fx',devin:root+'/devin/bin/devin',muse:root+'/muse',grok:root+'/grok/grok',minimax:root+'/minimax/node_modules/.bin/mcode'};
const results=[];
for(const name of (process.argv[3]||'ante,fx,devin,muse,minimax,grok').split(',')){
  const record=await isolated(async({launch})=>({name,version:await launch(binaries[name],['--version']),help:await launch(binaries[name],['--help'])}));
  results.push(record); await writeFile(process.argv[2]||'/tmp/cordyceps-vendor-help.json',JSON.stringify(results,null,2));console.log(name,record.version.stdout.trim(),record.version.stderr.trim());
}
