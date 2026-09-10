"use strict";
const path=require('node:path');
const fs=require('node:fs');
const {packager}=require('@electron/packager');

async function main(){
  if(process.platform!=='darwin')throw new Error('This first desktop build targets macOS.');
  const source=path.resolve(__dirname,'..'),root=path.resolve(source,'../..');
  const staging=path.join(root,'.runtime','desktop-staging');
  fs.mkdirSync(staging,{recursive:true});
  const checkout=path.join(staging,'checkout.json');
  fs.writeFileSync(checkout,JSON.stringify({workspace:root,mode:'development-checkout'},null,2)+'\n',{mode:0o600});
  const outputs=await packager({dir:source,name:'eïlo',platform:'darwin',arch:process.arch,
    electronVersion:require('../package.json').devDependencies.electron,
    out:path.join(root,'.runtime','desktop-build'),overwrite:true,asar:true,
    appBundleId:'app.eilo.desktop.dev',appVersion:require('../package.json').version,
    appCategoryType:'public.app-category.productivity',icon:path.join(source,'assets','icon.icns'),
    extraResource:[checkout],
    ignore:[/\.test\.cjs$/, /\/scripts(?:\/|$)/, /\/README\.md$/, /\/package-lock\.json$/, /\/node_modules(?:\/|$)/],
    extendInfo:{NSMicrophoneUsageDescription:'eïlo uses your microphone when you choose Speak. Audio is transcribed locally into an editable message.',NSHighResolutionCapable:true},
    usageDescription:{Microphone:'eïlo transcribes recordings locally when you choose Speak.'},
  });
  for(const output of outputs)process.stdout.write(output+'\n');
}
main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
