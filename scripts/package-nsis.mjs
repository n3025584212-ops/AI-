import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {root,configureProjectEnv} from './project-env.mjs';
import {assertPackagingAllowed} from './package-policy.mjs';
import {ensureElectron} from './ensure-electron.mjs';
import {ensureModelRuntime,verifyPackagedModelRuntime} from './model-packaging.mjs';
import {prepareOfflineNsis,OFFLINE_PAYLOAD_NAME} from './offline-nsis.mjs';
import {installOfflineNsisHook} from './offline-nsis-builder.mjs';
configureProjectEnv();assertPackagingAllowed(root);
const dirOnly=process.argv.includes('--dir');
if(process.argv.slice(2).some(x=>x!=='--dir'))throw Error('Unsupported packaging argument');
await ensureElectron({root});ensureModelRuntime({root});
const buildResult=spawnSync(process.execPath,[path.join(root,'scripts/build.mjs')],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
if(buildResult.status!==0)throw Error('Production frontend build failed');
Object.assign(process.env,{CSC_IDENTITY_AUTO_DISCOVERY:'false',ELECTRON_BUILDER_7Z_FILTER:'BCJ',ELECTRON_BUILDER_COMPRESSION_LEVEL:'3'});
const require=createRequire(path.join(root,'package.json')), {build,Platform,Arch}=require('electron-builder');
let restore=()=>{};if(!dirOnly){await prepareOfflineNsis(root);restore=installOfflineNsisHook(root);}
try{await build({projectDir:root,targets:Platform.WINDOWS.createTarget(dirOnly?'dir':'nsis-web',Arch.x64),publish:'never',config:{electronDist:'node_modules/electron/dist'}});}finally{restore();}
const output=path.join(root,'rebuild-output');
const modelResult=verifyPackagedModelRuntime({root,resourcesPath:path.join(output,'win-unpacked/resources')});
if(!dirOnly){const nsis=path.join(output,'nsis-web');const payloads=fs.readdirSync(nsis).filter(n=>n.endsWith('-x64.nsis.7z'));if(payloads.length!==1)throw Error('Expected one offline payload');fs.copyFileSync(path.join(nsis,payloads[0]),path.join(nsis,OFFLINE_PAYLOAD_NAME));}
fs.writeFileSync(path.join(root,'verification',dirOnly?'PACKAGE_DIR_RESULT.json':'PACKAGE_NSIS_RESULT.json'),JSON.stringify({status:'PASS',version:'1.1.0',kind:dirOnly?'directory':'offline-installer',output,model:modelResult},null,2)+'\n');
console.log('Independent rebuild verified; original releases remain untouched.');
