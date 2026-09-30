// Diagnostic only: 404 collector observes service requests, never makes model decisions.
import {isolated} from './isolation.mjs';
import {createServer} from 'node:http';
import {writeFile,mkdir} from 'node:fs/promises';
const binary=process.env.CORDYCEPS_DEVIN_BINARY||'/tmp/cordyceps-vendor-investigation/devin/bin/devin';
const evidence={passed:false,binary,date:new Date().toISOString(),attempts:[]};
await isolated(async({launch,env:baseEnv})=>{
  evidence.version=await launch(binary,['--version']);
  evidence.help=await launch(binary,['--help']);
  const raw=[];
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    raw.push({method:req.method,path:req.url,bodyBase64:body.toString('base64'),bodyText:body.toString('utf8'),headers:req.headers});
    res.writeHead(404,{'content-type':'application/json'});res.end('{"error":"unconfigured diagnostic endpoint"}');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;
  try {
    for(const env of [{},{WINDSURF_API_KEY:'cordyceps-test',WINDSURF_API_SERVER_URL:url,DEVIN_API_URL:url}]) {
      if(env.WINDSURF_API_KEY){
        await mkdir(baseEnv.XDG_DATA_HOME+'/devin',{recursive:true});
        await writeFile(baseEnv.XDG_DATA_HOME+'/devin/credentials.toml',`windsurf_api_key = "cordyceps-test"
api_server_url = "${url}"
devin_api_url = "${url}"
devin_webapp_host = "${url}"
`);
      }
      raw.length=0;
      const process=await launch(binary,['--respect-workspace-trust','false','--permission-mode','dangerous','-p','cordyceps-devin-text: Reply with controlled text.'],env,[],25000);
      evidence.attempts.push({env,process,requests:[...raw],passed:false});
    }
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
evidence.cleanedUp=true;
await writeFile(process.argv[2]||'/tmp/cordyceps-devin-diagnostic.json',JSON.stringify(evidence,null,2)+'\n');
console.log('Devin diagnostic captured; this is not a successful text/tool verification.');
