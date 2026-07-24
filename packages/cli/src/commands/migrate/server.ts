import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';

const DASHBOARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Immich Migration</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,sans-serif;margin:0;padding:2rem;max-width:820px;margin:auto;
  background:#fff;color:#111}
@media(prefers-color-scheme:dark){body{background:#14151a;color:#e6e6e6}
  .card{background:#1e2027!important;border-color:#333!important}.bar{background:#2a2d36!important}}
h1{font-size:1.3rem}.sub{opacity:.7;font-size:.85rem;margin-top:-.6rem}
.card{border:1px solid #e2e2e2;border-radius:10px;padding:1rem 1.2rem;margin:1rem 0}
.row{display:flex;justify-content:space-between;padding:.25rem 0;font-variant-numeric:tabular-nums}
.bar{height:8px;background:#eee;border-radius:6px;overflow:hidden;margin:.35rem 0}
.bar>i{display:block;height:100%;background:#4f8cff;width:0;transition:width .4s}
.phase{font-weight:600}.msg{opacity:.75;font-size:.85rem;min-height:1.1em}
button{font:inherit;padding:.45rem .9rem;border-radius:8px;border:1px solid #bbb;background:transparent;
  color:inherit;cursor:pointer;margin-right:.5rem}
.ok{color:#1a9e5b;font-weight:600}.bad{color:#d33;font-weight:600}
</style></head><body>
<h1>Immich Migration</h1>
<div class="sub" id="route"></div>
<div class="card">
  <div class="row"><span class="phase" id="phase">…</span><span id="pausedFlag"></span></div>
  <div class="msg" id="msg"></div>
  <div class="bar"><i id="uploadBar"></i></div>
  <div class="row"><span>Uploaded</span><span id="uploaded">0 / 0</span></div>
  <div class="bar"><i id="metaBar"></i></div>
  <div class="row"><span>Metadata applied</span><span id="meta">0 / 0</span></div>
  <div class="row"><span>Failed</span><span id="failed">0</span></div>
  <div style="margin-top:1rem">
    <button onclick="post('/pause')">Pause</button>
    <button onclick="post('/resume')">Resume</button>
    <button onclick="post('/stop')">Stop (resumable)</button>
  </div>
</div>
<div class="card">
  <div class="row"><span>Albums linked</span><span id="albums">0 / 0</span></div>
  <div class="row"><span>Tags assigned</span><span id="tags">0 / 0</span></div>
  <div class="row"><span>Stacks</span><span id="stacks">0 / 0</span></div>
  <div class="row"><span>People</span><span id="people">0 / 0</span></div>
</div>
<div class="card" id="auditCard" style="display:none">
  <div class="row"><span class="phase">Audit</span><span id="auditVerdict"></span></div>
  <div class="msg" id="auditMsg"></div>
</div>
<script>
const $=id=>document.getElementById(id);
const pct=(a,b)=>b>0?Math.round(a/b*100):0;
async function post(p){await fetch(p,{method:'POST'});tick()}
async function tick(){
  let s;try{s=await(await fetch('/status')).json()}catch(e){return}
  const c=s.counts||{};
  $('route').textContent=s.user+'  ·  '+s.from+'  →  '+s.to;
  $('phase').textContent=(s.dryRun?'[dry-run] ':'')+'Phase: '+s.phase;
  $('pausedFlag').textContent=s.paused?'⏸ paused':(s.stopped?'⏹ stopped':(s.running?'● running':''));
  $('msg').textContent=s.error?('Error: '+s.error):s.message;
  $('uploaded').textContent=(c.assetsUploaded||0)+' / '+(c.assetsTotal||0);
  $('uploadBar').style.width=pct(c.assetsUploaded,c.assetsTotal)+'%';
  $('meta').textContent=(c.assetsMeta||0)+' / '+(c.assetsUploaded||0);
  $('metaBar').style.width=pct(c.assetsMeta,c.assetsUploaded)+'%';
  $('failed').textContent=c.assetsFailed||0;
  $('albums').textContent=(c.albumsLinked||0)+' / '+(c.albumsTotal||0);
  $('tags').textContent=(c.tagsAssigned||0)+' / '+(c.tagsTotal||0);
  $('stacks').textContent=(c.stacksDone||0)+' / '+(c.stacksTotal||0);
  $('people').textContent=(c.peopleDone||0)+' / '+(c.peopleTotal||0);
  if(s.phase==='done'||s.phase==='audit'){
    try{const a=await(await fetch('/audit')).json();
      if(a&&a.generatedAt){$('auditCard').style.display='block';
        $('auditVerdict').innerHTML=a.ok?'<span class=ok>PASS — safe to decommission A</span>':'<span class=bad>INCOMPLETE</span>';
        $('auditMsg').textContent='missing: '+(a.totals?a.totals.missing:'?')+', failed: '+(a.totals?a.totals.failed:'?');}}catch(e){}
  }
}
setInterval(tick,1500);tick();
</script></body></html>`;

/**
 * A tiny localhost-only dashboard. The Node process (and thus the migration) keeps running
 * regardless of the browser, so the tab can be closed and reopened freely. Read-only status
 * from SQLite COUNTs + pause/resume/stop controls. No credentials are ever exposed.
 */
export function startDashboard(
  port: number,
  controller: Controller,
  ledger: Ledger,
  meta: { from: string; to: string; user: string },
  auditPath: string,
  dryRun: boolean,
): Server {
  const server = createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'POST') {
      switch (url) {
        case '/pause': {
          controller.pause();
          break;
        }
        case '/resume': {
          controller.resume();
          break;
        }
        case '/stop': {
          {
            controller.stop();
            // No default
          }
          break;
        }
      }
      res.writeHead(204).end();
      return;
    }
    if (url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          running: controller.running,
          paused: controller.paused,
          stopped: controller.stopped,
          phase: controller.phase,
          message: controller.message,
          error: controller.error,
          startedAt: controller.startedAt,
          from: meta.from,
          to: meta.to,
          user: meta.user,
          dryRun,
          counts: ledger.counts(),
        }),
      );
      return;
    }
    if (url === '/audit') {
      try {
        res.writeHead(200, { 'content-type': 'application/json' }).end(await readFile(auditPath, 'utf8'));
      } catch {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(DASHBOARD_HTML);
  });
  server.listen(port, '127.0.0.1');
  return server;
}
