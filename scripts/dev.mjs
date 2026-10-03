import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
try {process.loadEnvFile('.env');} catch {}
const viteArgs=process.argv.slice(2);
const python=process.env.PYTHON_BIN??(existsSync('.venv/bin/python')?'.venv/bin/python':existsSync('.venv/Scripts/python.exe')?'.venv/Scripts/python.exe':'python');
const processes=[spawn(python,['-m','uvicorn','backend.app:app','--reload','--host','127.0.0.1','--port','3001'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js',...(viteArgs.length?viteArgs:['--host','0.0.0.0','--port','5173'])],{stdio:'inherit'})];
for(const child of processes)child.on('error',error=>{console.error(error.message);for(const sibling of processes)if(sibling!==child)sibling.kill();process.exit(1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const child of processes)child.kill(signal);process.exit(0);});
for(const child of processes)child.on('exit',code=>{if(code){for(const sibling of processes)if(sibling!==child)sibling.kill();process.exit(code);}});
