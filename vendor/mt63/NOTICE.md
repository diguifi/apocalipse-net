# MT63 modem provenance

`mt63Wasm.js` and `mt63Wasm.wasm` are unmodified runtime files from
`@hamstudy/mt63-wasm` **1.5.0** (npm tarball SHA-1
`96620031415ffb4de665e011ae7bc8a9362f3f7b`).

WASM SHA-256: `34fc937d528349d6e5ed7c2b5d4ef001bb8a4aafa954db489733527bc69d3dc8`.

- Project: https://github.com/taxilian/mt63_wasm
- Package: https://www.npmjs.com/package/@hamstudy/mt63-wasm/v/1.5.0
- License: **GPL-3.0-or-later**, reproduced in `COPYING.txt`.
- WebAssembly port: Richard Bateman / HamStudy.org.
- MT63 implementation: Pawel Jalocha, SP9VRC, and Dave Freese, W1HKJ,
  derived from fldigi. Original notices are retained in the source archive.

`upstream-source.tar.gz` contains the upstream source at the exact git head
recorded in the 1.5.0 npm release metadata:
`1752254f03f974114e6002fa4b02b92b657abb57` (June 1, 2021). It includes
the modem, DSP routines, and build scripts. A byte-for-byte reproducible WASM
build has not been independently verified.

The runtime is embedded, without changing its modem implementation, into
`index.html` by `scripts/embed-modems.cjs`. This preserves offline `file://`
operation: loading the page never fetches WASM or JavaScript from a CDN.
The application's adapter is maintained in `src/protocols.js`.

The adapter calls `encodeString(text, 2000, 1)` and `initRx(2000, 1, 16, 0)`.
It uses the native 8 kHz audio API and its own continuous resampler rather than
the package's optional resampling wrapper. Application records are grouped into
continuous bursts with at most 7600 record characters, keeping native encode
buffers below the library's initial ten-minute allocation. The receive signal-
quality gate is disabled: frame FCS and chunk/file CRC validation remain mandatory,
so transient quality dips do not delete otherwise recoverable characters.
