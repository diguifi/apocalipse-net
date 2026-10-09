# Apocalipse Net

Open [index.html](index.html) directly in a browser. It is a portable, offline file transfer page; no server or package install is needed. The **Download** button in the top-right corner saves a standalone `index.html` copy with the embedded modem and source download.

In **Transmit**, select MT63-2000L, AX.25, or multi-tone FSK, then choose one file or enter plain text and select **Generate**. Plain text is sent as `message.txt`; uploaded files retain their original bytes, including HTML and ZIP files. Both use repeating audio or a one-pass WAV. The packed transfer, including metadata, is limited to 256 KiB; WAV export is limited to ten minutes. An empty protocol selection disables file upload, text generation, and audio controls.

In **Receive**, one microphone stream feeds three independent protocol decoders. Each receiver has a compact status row showing listening state or validated packet progress. Select a row to view its details and latest completed transfer beside the rows on wide screens, or below them on narrow screens; this does not change which decoders are enabled. The preview stays hidden until a transfer completes, and progress bars appear after the first validated packet. Each receiver can be enabled or disabled while listening. Completed files remain in a list below the receiver details until the page is reloaded. Each has a download button and selection checkbox. HTML files and ZIP files containing an HTML entry page also have **Open site**, which opens the received content in a new tab. Links between HTML pages in a received ZIP work in that view. Received HTML is displayed without removing scripts, links, forms, styles, or remote resources. **Download** saves one selected file or a ZIP of multiple selected files; **Remove**, **Select all**, and **Deselect all** manage the list. Previews have scrollbars for large content.

The receiver accepts both current `APF1` file transfers and legacy `APW1` sites. Legacy sites show their entry page and offer downloads of reconstructed files; the original ZIP bytes cannot be recovered from an `APW1` transfer. The link is one way and unencrypted. Transfers use a validated basename, media type, size, full-file CRC32, chunk checksums, and AX.25 frame FCS.

| Protocol | Audio and error handling | WAV sample rate |
| --- | --- | --- |
| AX.25 | 1200 baud Bell 202 AFSK, NRZI, bit stuffing, AX.25 UI frames and FCS | 12 kHz |
| MT63-2000L | Standard MT63, 2000 Hz bandwidth centered at 1500 Hz, long interleave, native forward error correction; fldigi-derived WebAssembly modem | 8 kHz |
| multi-tone FSK | Custom four-tone format: 700/1100/1500/1900 Hz, 40 ms symbols, 50 raw bit/s, interleaved Hamming(7,4) error correction | 8 kHz |

MT63 carries printable application records. Its audio is compatible with MT63-2000L decoders, but reconstructing files requires this application's record format. The receive console marks unverified MT63 characters as `RAW`; only validated packets advance progress. The log includes packet progress, errors, audio diagnostics, and a microphone capture check approximately every ten seconds. **Download log** saves the full in-memory history; **Clear** erases it.

For development, edit `src/core.js`, `src/protocols.js`, `src/capture.js`, `src/enhanced-app.js`, or `src/enhanced.html`, then regenerate the standalone page:

```powershell
node --preserve-symlinks --preserve-symlinks-main scripts/embed-modems.cjs
```

Run the Node tests:

```powershell
node --preserve-symlinks --preserve-symlinks-main --test tests/core.test.js tests/enhanced.test.js tests/modems.test.js tests/capture.test.js
```

The preserve-symlinks flags are needed only in workspaces where Node cannot resolve an ancestor directory due to filesystem sandboxing.

For browser integration, start an isolated headless Chromium or Edge instance with `--headless --remote-debugging-port=9229 --autoplay-policy=no-user-gesture-required --user-data-dir=<temporary-profile> about:blank`, then run `node --preserve-symlinks --preserve-symlinks-main tests/browser-enhanced.cjs`. This checks the actual page, all three WAV modes, receiver lanes, previews, downloads, legacy reception, microphone cleanup, and AudioWorklet capture during a page stall. It uses synthetic audio without microphone access and closes the test browser.

For the longer real-time MT63 regression, start another isolated browser with port `9230` and run `node --preserve-symlinks --preserve-symlinks-main tests/browser-mt63-realtime.cjs`. It feeds a generated WAV through an independently clocked MediaStream into the receive UI and checks capture timing beyond 30 seconds. Add `--compare-legacy` to also report the previous muted-output graph's results.

## Redistribution

The combined page and its editable sources are distributed under [GPL-3.0-or-later](COPYING.txt). The embedded MT63 runtime is version 1.5.0, whose recorded release commit is available in the bundled [upstream source archive](vendor/mt63/upstream-source.tar.gz); see [provenance](vendor/mt63/NOTICE.md). A byte-for-byte rebuild of its WASM has not been independently verified.

`index.html` includes a footer link that downloads a source archive containing this project's `src/`, `scripts/`, `vendor/`, README, and GPL license. This keeps a copy of the corresponding source and license available to anyone who receives only the standalone HTML file. The page runs offline and the source download also works offline.
