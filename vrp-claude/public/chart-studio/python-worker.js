/* Pinned runtime: Python runs off the UI thread. Stop terminates this worker. */
let runtime;
self.onmessage = async ({ data }) => {
  const { id, code, payload, operation } = data;
  const reply = value => {
    if (value.error && typeof value.error === 'object') {
      value = { ...value, diagnostic: value.error, error: `${value.error.type}: ${value.error.message}` };
    }
    self.postMessage({ id, ...value });
  };
  try {
    if (!runtime) {
      self.postMessage({ id, status: 'Loading Python + pandas…' });
      importScripts('/chart-studio/runtime/pyodide.js');
      const loaded = await loadPyodide({ indexURL: '/chart-studio/runtime/' });
      await loaded.loadPackage(['numpy', 'pandas']);
      const response = await fetch('/chart-studio/sdk.py');
      if (!response.ok) throw new Error('Python SDK could not be loaded');
      loaded.runPython(await response.text());
      runtime = loaded;
    }
    self.postMessage({ id, status: operation === 'validate' ? 'Checking syntax…' : 'Computing…', ready: true });
    let logSize = 0;
    const log = text => { if (logSize < 16000) { logSize += text.length; self.postMessage({ id, log: text.slice(0, 2000) }); } };
    runtime.setStdout({ batched: log }); runtime.setStderr({ batched: log });
    runtime.globals.set('_studio_code', code);
    const validation = JSON.parse(runtime.runPython('studio_request(_studio_code, validate=True)'));
    if (validation.error || operation === 'validate') { reply(validation); return; }
    await runtime.loadPackagesFromImports(code);
    runtime.globals.set('_studio_payload', JSON.stringify(payload));
    const start = performance.now();
    const result = runtime.runPython('studio_request(_studio_code, json.loads(_studio_payload))');
    if (result.length > 16_000_000) throw new Error('Output exceeds 16 MB. Reduce lookback or number of plots.');
    reply({ ...JSON.parse(result), duration: performance.now() - start });
  } catch (e) { reply({ error: String(e.message || e), fatal: !runtime }); }
};
