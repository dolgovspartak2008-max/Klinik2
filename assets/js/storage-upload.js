(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FZStorageUpload = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024 - 5 * 1024 * 1024;

  function putFile(url, file, onProgress, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open("PUT", url);
      Object.keys(options.headers || {}).forEach(function (name) { x.setRequestHeader(name, options.headers[name]); });
      if (!options.raw) x.setRequestHeader("x-upsert", "false");
      x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = function () { x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("upload " + x.status)); };
      x.onerror = function () { reject(new Error("network")); };
      if (options.raw) {
        x.send(file);
        return;
      }
      var fd = new FormData();
      fd.append("cacheControl", "3600");
      fd.append("", file);
      x.send(fd);
    });
  }

  return { MAX_VIDEO_BYTES: MAX_VIDEO_BYTES, putFile: putFile };
});
