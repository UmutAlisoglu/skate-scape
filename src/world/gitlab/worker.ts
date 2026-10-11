// Builds an area's world files from 2009scape's GitLab in a worker, so the page stays responsive (see build.ts).
import { gitlabSource, openIndexedDbCache } from '../../../tools/cache/http-store.ts';
import { buildRemoteArea, type RemoteBuildReport } from '../../../tools/world/remote-build.ts';

export interface BuildRequest { area: string; project?: string; ref?: string; blockSize?: number; concurrency?: number; cache: boolean }
export type BuildMessage =
  | { type: 'progress'; step: string }
  | { type: 'done'; world: [string, Uint8Array][]; surfaces: [string, Uint8Array][]; report: RemoteBuildReport & { workerHeap?: number } }
  | { type: 'error'; message: string };

const post = (message: BuildMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async ({ data }: MessageEvent<BuildRequest>) => {
  try {
    const { world, surfaces, report } = await buildRemoteArea(data.area, {
      source: gitlabSource(data.project, data.ref), blockSize: data.blockSize, concurrency: data.concurrency,
      cache: data.cache ? await openIndexedDbCache() : null,
      progress: (step) => post({ type: 'progress', step }),
    });
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    const files = [...world.values(), ...surfaces.values()].map((d) => d.buffer).filter((b, i, all) => all.indexOf(b) === i);
    post({ type: 'done', world: [...world], surfaces: [...surfaces], report: { ...report, workerHeap: heap } }, files as ArrayBuffer[]);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
};
