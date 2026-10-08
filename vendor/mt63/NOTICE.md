# MT63 modem provenance

`mt63Wasm.js` and `mt63Wasm.wasm` are unmodified runtime files from
`@hamstudy/mt63-wasm` **1.5.1** (npm tarball SHA-1
`f06365244a0ddfaba1e9d8df18fe3b6971d81daa`).

WASM SHA-256: `be41cd6ca294678c1efafe71a9d3c9276ae70f1fd2c53531c3e3ce96ec71aa36`.

- Project: https://github.com/taxilian/mt63_wasm
- Package: https://www.npmjs.com/package/@hamstudy/mt63-wasm/v/1.5.1
- License: **GPL-3.0-or-later**, reproduced in `COPYING.txt`.
- WebAssembly port: Richard Bateman / HamStudy.org.
- MT63 implementation: Pawel Jalocha, SP9VRC, and Dave Freese, W1HKJ,
  derived from fldigi. Original notices are retained in the source archive.

`upstream-source.tar.gz` contains the upstream source snapshot at `122e700`
(June 4, 2021), including the modem, DSP routines, and build scripts. The npm
release's metadata identifies git head `9c2b86c08988adb9f413b5e0899b47d05f8d8a3c`,
which the upstream repository no longer serves; this archive is the available
2021 source snapshot, not a claimed reproducible match of that unavailable commit.

The runtime is embedded, without changing its modem implementation, into
`apocalipse.html` by `scripts/embed-modems.cjs`. This preserves offline `file://`
operation: loading the page never fetches WASM or JavaScript from a CDN.
The application's adapter is maintained in `src/protocols.js`.

The adapter calls `encodeString(text, 2000, 1)` and `initRx(2000, 1, 16, 0)`.
It uses the native 8 kHz audio API and its own continuous resampler rather than
the package's optional resampling wrapper. Application records are grouped into
continuous bursts with at most 7600 record characters, keeping native encode
buffers below the library's initial ten-minute allocation. The receive signal-
quality gate is disabled: frame FCS and chunk/file CRC validation remain mandatory,
so transient quality dips do not delete otherwise recoverable characters.
