const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

/** Render app JSX with explicit native mocks; native layout/animation still require device validation. */
function loadTsx(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '../..', relativePath);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = loaded.require.bind(loaded);
  loaded.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name);
  loaded._compile(output, filename);
  return loaded.exports;
}

module.exports = { loadTsx };
