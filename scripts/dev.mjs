import {spawn} from 'node:child_process';
const viteArgs=process.argv.slice(2);
const processes=[spawn(process.execPath,['--watch','--import','tsx','server/express.ts'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js',...(viteArgs.length?viteArgs:['--host','0.0.0.0','--port','5173'])],{stdio:'inherit'})];
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const child of processes)child.kill(signal);process.exit(0);});
for(const child of processes)child.on('exit',code=>{if(code){for(const sibling of processes)if(sibling!==child)sibling.kill();process.exit(code);}});
