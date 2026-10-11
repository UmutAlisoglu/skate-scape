// ?source=gitlab: instead of loading exported files from public/world, build the area in the visitor's browser
// straight from the 2009scape cache on GitLab (fetched with Range requests and kept in IndexedDB), then serve the
// built files to the usual loaders from memory (provideAssets). See tools/world/remote-build.ts.
import { ASSET_BASE, provideAssets } from '../load.ts';
import type { BuildMessage, BuildRequest } from './worker.ts';

export type GitlabBuildReport = Extract<BuildMessage, { type: 'done' }>['report'] & { wallMs: number };

export async function buildFromGitlab(area: string, progress: (step: string) => void): Promise<GitlabBuildReport> {
  const params = new URLSearchParams(location.search);
  const request: BuildRequest = {
    area, cache: params.get('cache') !== 'off',
    project: params.get('project') ?? undefined, ref: params.get('ref') ?? undefined,
    blockSize: Number(params.get('block')) || undefined, concurrency: Number(params.get('concurrency')) || undefined,
  };
  const started = performance.now();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise<Extract<BuildMessage, { type: 'done' }>>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<BuildMessage>) => {
        if (data.type === 'progress') progress(`${data.step}…`);
        else if (data.type === 'done') resolve(data);
        else reject(new Error(data.message));
      };
      worker.onerror = (event) => reject(new Error(event.message || 'the world builder failed to start'));
      worker.postMessage(request);
    });
    provideAssets(`${ASSET_BASE}world/${area}`, new Map(result.world));
    provideAssets(`${ASSET_BASE}surfaces`, new Map(result.surfaces));
    return { ...result.report, wallMs: performance.now() - started };
  } finally {
    worker.terminate();
  }
}
