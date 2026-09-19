/// <reference lib="webworker" />
// The engine on a thread of its own.
//
// It was on the main thread, which meant the tab sat frozen for the whole
// effort budget: no spinner could turn, no button could be pressed, and a ten
// second search looked exactly like a crash. The engine is a single blocking
// call by design, so the only way to keep the page alive is to run it somewhere
// else.

import createModule from "./nest-engine.js";

interface EngineModule {
  ccall: (
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ) => number;
  UTF8ToString: (pointer: number) => string;
}

export interface NestWorkerRequest {
  id: number;
  payload: string;
}

export interface NestWorkerResponse {
  id: number;
  text?: string;
  error?: string;
}

let enginePromise: Promise<EngineModule> | null = null;

function engine(): Promise<EngineModule> {
  if (!enginePromise) {
    enginePromise = (
      createModule as unknown as (options: object) => Promise<EngineModule>
    )({
      // Served from public/, because bundlers move the glue and the binary
      // apart and the glue then looks for its payload beside itself.
      locateFile: (path: string) =>
        path.endsWith(".wasm") ? "/nest-engine.wasm" : path,
    });
  }
  return enginePromise;
}

self.onmessage = async (event: MessageEvent<NestWorkerRequest>) => {
  const { id, payload } = event.data;
  try {
    const mod = await engine();
    const pointer = mod.ccall("nest_run", "number", ["string"], [payload]);
    const text = mod.UTF8ToString(pointer);
    mod.ccall("nest_free", null, ["number"], [pointer]);
    self.postMessage({ id, text } satisfies NestWorkerResponse);
  } catch (failure) {
    self.postMessage({
      id,
      error: failure instanceof Error ? failure.message : String(failure),
    } satisfies NestWorkerResponse);
  }
};
