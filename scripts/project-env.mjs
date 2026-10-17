import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function configureProjectEnv(){
  const dirs={TEMP:'tmp/process',TMP:'tmp/process',npm_config_cache:'tmp/npm-cache',ELECTRON_BUILDER_CACHE:'toolchain/builder-cache',APPDATA:'.runtime-data/profile/Roaming',LOCALAPPDATA:'.runtime-data/profile/Local'};
  for(const [key,relative]of Object.entries(dirs)){const dir=path.join(root,relative);fs.mkdirSync(dir,{recursive:true});process.env[key]=dir;}
  process.env.DKQKAR_PYTHON=path.join(root,'model-runtime/python.exe');
  process.env.DKQKAR_LOCAL_LLM_ROOT=path.join(root,'data/local-llm');
  process.env.PATH=path.join(root,'toolchain/node')+path.delimiter+process.env.PATH;
  fs.mkdirSync(path.join(root,'tmp/test-data'),{recursive:true});
  return root;
}
