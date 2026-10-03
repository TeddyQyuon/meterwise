import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
mkdirSync('dist/server',{recursive:true});
await build({entryPoints:['server/worker.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
writeFileSync('dist/server/wrangler.json',JSON.stringify({name:'meterwise',main:'index.js',compatibility_date:'2026-05-15',assets:{directory:'../client',binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*']},d1_databases:[{binding:'DB',database_name:'meterwise',database_id:'local-meterwise',migrations_dir:'../../drizzle'}]},null,2));
console.log('MeterWise Worker and client build ready.');
