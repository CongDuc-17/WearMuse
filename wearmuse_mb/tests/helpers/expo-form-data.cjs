const { loadTs } = require('./load-ts.cjs');

// These are the installed SDK 57 implementations, not a reimplementation of multipart encoding.
const blobUtils = loadTs('node_modules/expo/src/utils/blobUtils.ts');
const { installFormDataPatch } = loadTs('node_modules/expo/src/winter/FormData.ts');
const converter = loadTs('node_modules/expo/src/winter/fetch/convertFormData.ts', {
  '../../utils/blobUtils': blobUtils,
});
const requestUtils = loadTs('node_modules/expo/src/winter/fetch/RequestUtils.ts', {
  './convertFormData': converter,
  '../../utils/blobUtils': blobUtils,
});

function installExpoFormData() {
  const previous = global.FormData;
  // RN's backing storage only; append, validation and iteration come from Expo's actual patch.
  class ReactNativeFormData { constructor() { this._parts = []; } }
  installFormDataPatch(ReactNativeFormData);
  global.FormData = ReactNativeFormData;
  return () => { global.FormData = previous; };
}

function loadGarmentsApi(FileClass) {
  const logger = loadTs('src/services/diagnostics/logger.ts');
  const client = loadTs('src/services/api/client.ts', { '../diagnostics/logger': logger });
  const garments = loadTs('src/services/api/garments.ts', {
    'expo-file-system': { File: FileClass },
    './client': client,
    '../diagnostics/logger': logger,
  });
  return { ...client, ...garments };
}

module.exports = {
  installExpoFormData,
  loadGarmentsApi,
  convertFormDataAsync: converter.convertFormDataAsync,
  normalizeBodyInitAsync: requestUtils.normalizeBodyInitAsync,
};
