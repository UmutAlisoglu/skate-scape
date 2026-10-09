import type { WebGLRenderer } from 'three';

export interface FrameTimings { physics: number; animation: number; render: number; total: number }
/** Opt-in local diagnostics. Measures real frame intervals, including GPU/browser stalls. */
export class PerformanceMonitor {
  private node: HTMLPreElement | null = null;
  private intervals: number[] = [];
  private timings: FrameTimings[] = [];
  private previous = 0;
  private lastReport = 0;
  private gpuName = '';
  private measuring=false;
  private clientId=crypto.randomUUID();
  private browserName=navigator.userAgent;
  constructor(private renderer: WebGLRenderer) {
    const visible=new URLSearchParams(location.search).has('perf');
    this.measuring=visible||import.meta.env.DEV;
    if(!this.measuring)return;
    if(visible) {
      this.node = document.createElement('pre'); this.node.id = 'performance'; this.node.dataset.testid = 'performance';
      this.node.style.cssText = 'position:fixed;left:8px;bottom:64px;background:#101b19eb;color:#d9f4d7;padding:10px;font:11px/1.4 monospace;pointer-events:none;z-index:10;max-width:48vw';
      document.body.append(this.node);
    }
    const brave=(navigator as Navigator&{brave?:{isBrave():Promise<boolean>}}).brave;
    if(brave)void brave.isBrave().then(isBrave=>{if(isBrave)this.browserName='Brave';}).catch(()=>{});
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
  }
  get enabled() { return this.measuring; }
  sample(time: number, timings: FrameTimings, extras: Record<string, unknown> = {}) {
    if (!this.measuring) return;
    if (this.previous) this.intervals.push(time-this.previous);
    this.previous = time; this.timings.push(timings);
    if (time-this.lastReport < 2000 || this.intervals.length < 10) return;
    this.lastReport = time;
    const mean = (values: number[]) => values.reduce((a,b)=>a+b,0)/values.length;
    const frames = [...this.intervals].sort((a,b)=>a-b);
    const report = { fps: +((1000/mean(frames)).toFixed(1)), frameMs: +mean(frames).toFixed(2), p95Ms: +frames[Math.floor(frames.length*0.95)].toFixed(2),
      cpu: Object.fromEntries((['physics','animation','render','total'] as const).map(key=>[key,+mean(this.timings.map(t=>t[key])).toFixed(2)])),
      triangles: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls,
      width: this.renderer.domElement.width, height: this.renderer.domElement.height, gpu: this.gpuName,visibility:document.visibilityState,focused:document.hasFocus(),browser:this.browserName,test:new URLSearchParams(location.search).has('test'), ...extras };
    if(this.node){this.node.textContent = JSON.stringify(report,null,2);this.node.dataset.report = JSON.stringify(report);}
    if(import.meta.env.DEV)void fetch('/__game_performance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...report,clientId:this.clientId})}).catch(()=>{});
    this.intervals = []; this.timings = [];
  }
}
