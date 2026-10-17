const {app}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
// The released business entry stays byte-identical. Only development profiles are isolated.
if(!app.isPackaged){
  const profile=path.resolve(__dirname,'../.runtime-data/desktop');
  fs.mkdirSync(profile,{recursive:true});
  app.setPath('userData',profile);
}
require('./main.cjs');
