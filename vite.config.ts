import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{outDir:'dist/client'},server:{host:'0.0.0.0',port:5173,allowedHosts:['terminal.local'],proxy:{'/api':'http://127.0.0.1:3001'}}});
