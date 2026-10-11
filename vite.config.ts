import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

// Development-only, loopback diagnostics from the actual player browser.
export default defineConfig(({ command, isPreview }) => ({
  // The site is served from https://alisoglu.com/skate-scape/ (GitHub Pages, see docs/HOSTING.md); BASE_PATH=/ builds
  // for a domain root. The dev server stays at /.
  base: command === 'build' || isPreview ? process.env.BASE_PATH ?? '/skate-scape/' : '/',
  // public/ holds only the exported game assets (converted Jagex content, gigabytes for the whole world): a build
  // never copies them into dist/. The site builds its world in the browser from GitLab, or loads exports from a
  // separate host when the build sets VITE_ASSET_BASE.
  build: { copyPublicDir: false },
  // the exported world is tens of thousands of files (gigabytes for the whole of Gielinor): watching it, the
  // exporter's work files or a production build would stall the dev server for minutes
  server:{watch:{ignored:['**/public/world/**','**/public/npcs/**','**/public/player/**','**/public/surfaces/**','**/work/**','**/dist/**','**/vendor/**']}},
  plugins:[{
    name:'local-game-performance',
    configureServer(server) {
      const reports=new Map<string,unknown>();
      server.middlewares.use((request,response,next)=>{
        if(request.url?.split('?')[0]!=='/__game_performance') {next();return;}
        if(request.method==='GET') {
          response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
          response.end(JSON.stringify([...reports.values()]));return;
        }
        if(request.method!=='POST'){response.statusCode=405;response.end();return;}
        let body='';
        request.on('data',chunk=>{body+=chunk;if(body.length>16384)request.destroy();});
        request.on('end',()=>{
          try {
            const report=JSON.parse(body);
            if(typeof report.clientId!=='string'||!Number.isFinite(report.fps))throw new Error('Invalid report');
            reports.set(report.clientId,{...report,receivedAt:new Date().toISOString()});
            if(reports.size>16)reports.delete(reports.keys().next().value!);
            mkdirSync('work',{recursive:true});writeFileSync('work/performance.json',JSON.stringify([...reports.values()],null,2));
            response.statusCode=204;response.end();
          } catch {response.statusCode=400;response.end();}
        });
      });
    },
  }],
}));
