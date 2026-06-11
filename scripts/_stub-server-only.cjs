// Preload that neutralizes the `server-only` guard so build-query can be unit-tested
// outside the Next.js server runtime.
const Module = require("module")
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") {
    return require.resolve("./empty.cjs")
  }
  return originalResolve.call(this, request, ...args)
}
