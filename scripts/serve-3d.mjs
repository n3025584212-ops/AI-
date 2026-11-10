import path from 'node:path';
import {root,configureProjectEnv} from './project-env.mjs';
configureProjectEnv();
const {startServer}=await import('../server/index.mjs');
const port=Number(process.env.QCDKR_3D_PORT||5194);
const host=process.env.QCDKR_HOST||'127.0.0.1';
const server=await startServer({
  port,
  dataDir:path.join(root,'.runtime-data/web'),
  distDir:path.join(root,'dist-3d'),
  allowedOrigins:[`http://127.0.0.1:${port}`,`http://localhost:${port}`],
});
console.log(`QCDKR 3D build: http://127.0.0.1:${server.address().port}`);
let closing=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(closing)return;closing=true;server.close(()=>process.exit(0));});
