# Apocalipse Web

Open [apocalipse.html](apocalipse.html) by double-clicking it. No server, build step, package install, internet connection, or external modem application is required to use the page.

Choose **AX.25**, **MT63-2000L**, or **multi-tone FSK** in the top-right protocol selector. Both computers must select the same protocol. This changes live transmission, the generated WAV, the microphone decoder, timing estimates, and instructions. Changing protocol stops active transmission/reception, discards partial received data, and prepares the selected page for the new modem.

Use the **Transmit** tab to load a page and send or export its audio. The **Receive** tab contains microphone controls, the console log, and the preview. Switching tabs keeps active transmission and reception running. **Preview selected page** switches to Receive and scrolls to the preview.

1. Select an `.html` file or a `.zip` containing an HTML page and its local assets. ZIP entries may use stored or DEFLATE compression. Paths must be relative and remain inside the archive. The total reconstructed site, including its manifest, is limited to 256 KiB.
2. Connect computer audio output to the Radio transmitter's audio input. Select **Start repeating** and set the audio level conservatively. A full cycle repeats until stopped. **Download WAV** creates one pass for transfers up to ten minutes long.
3. Connect the Radio receiver's audio output to a microphone or line input. Select **Start microphone** and grant permission. Watch the level meter and packet progress. Dropped packets can arrive on later cycles.
4. The received page opens in a new tab when all packets and file checksums have been validated. If the browser blocks the automatic tab, an **Open received page in new tab** button appears; allow pop-ups for this page to enable automatic opening. The viewer supports local images, stylesheets, fonts, media, and links between HTML pages. Scripts and network resources remain blocked. The in-page preview is available for the selected transmission source.

The radio link is one way and unencrypted. Each transfer has a session ID, numbered chunks, a per-chunk CRC32, and a manifest with per-file CRC32. Files are validated before the page is displayed.

| Selection | Audio and error handling | WAV sample rate |
| --- | --- | --- |
| AX.25 | Original 1200 baud Bell 202 AFSK, NRZI, bit stuffing, AX.25 UI frames and FCS | 12 kHz |
| MT63-2000L | Standard MT63, 2000 Hz bandwidth centered at 1500 Hz, long interleave, native forward error correction; fldigi-derived WebAssembly modem | 8 kHz |
| multi-tone FSK | Custom four-tone format: 700/1100/1500/1900 Hz, 40 ms symbols, 50 raw bit/s, interleaved Hamming(7,4) error correction | 8 kHz |

MT63 uses printable `~APW1:` records containing base64-encoded application frames. The audio is standard MT63-2000L and the text can be decoded by compatible modems; page reconstruction requires this application's record format, rather than FLAMP or another file-transfer format. Both new modems retain the application frame's FCS in addition to chunk/file checksums. Multi-tone FSK is an application-specific format, not a claim of compatibility with fldigi's MFSK modes.

MT63 sends packets in continuous bursts rather than restarting the modem for each packet. A burst holds up to 7600 record characters; larger transfers use multiple bounded bursts. The receiver validates all decoded records by checksum instead of discarding character blocks when the modem's signal-quality estimate drops. The receive panel shows decoded character count, rejected records, valid packets including repeats, and time since the last new packet. These distinguish a slow transfer from ongoing decoding errors or repeated copies of the same packet.

The **Console log** beside the receive panel shows local timestamps and colored `INFO`, `RAW`, `DATA`, `SUCCESS`, `WARNING`, and `ERROR` tags. `RAW` identifies unverified MT63 decoder output, which can include random characters when no transmission is present. These characters do not advance page progress: frame FCS and application checksums must pass first. The log also includes validated frame bytes as hex and text for all modes, packet/session progress, repeats, rejected MT63/FSK candidates, audio warnings, capture settings, and file/transmit/receive errors. Received content is displayed as text, never executed as HTML.

Auto-scroll is enabled by default and can be unchecked to inspect earlier entries. The console displays the latest 500 entries; **Download log** exports the full history since the page opened or the last **Clear**, including entries still waiting to appear onscreen. The text file includes UTC timestamps, local time-zone information, selected protocol, browser, and current receive status. **Clear** empties both displayed and downloadable history. History is kept in memory and is lost on reload; download it before closing or reloading the page.

The slower modes can take substantially longer than AX.25. The loaded-file estimate includes modem synchronization and error-correction overhead. WAV export retains the ten-minute limit; longer transfers can use live repetition. Microphone decoding handles 44.1 and 48 kHz input using continuous filtered resampling. Real speaker/radio/microphone performance still depends on the audio path; synthetic round trips do not establish hardware reliability.

Microphone capture uses an embedded AudioWorklet to collect audio on the rendering thread and queue it for decoding. It has no speaker output connection: connecting a silent output made the receiver eligible for Chromium's 30-second silent-sink transition, which can disrupt capture timing. Chromium automatically processes worklets with unconnected outputs and disables that transition while such nodes are present ([worklet processing](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webaudio/audio_worklet_handler.cc), [silence detection](https://chromium.googlesource.com/chromium/src/+/lkgr/third_party/blink/renderer/modules/webaudio/realtime_audio_destination_handler.cc)).

The log identifies the capture backend and reports wall time, captured sample duration, and audio-clock elapsed time every ten seconds. It warns about clock drift, sample gaps, or a decoding backlog. Comparing against wall time detects slow capture even when the audio graph reports consecutive sample timestamps. Browsers that cannot load the worklet use a ScriptProcessor fallback with a warning; keep the page visible when using that fallback. Live transmission still uses ScriptProcessor.

Modern browsers generally regard `file://` as a secure context for microphone access, though microphone permission is still required and individual browser policies can restrict it. If microphone access is unavailable, the page reports that in the receive panel. See [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet).

Run the plain JavaScript tests with:

```powershell
node --preserve-symlinks --preserve-symlinks-main --test tests/core.test.js tests/modems.test.js tests/capture.test.js
```

The preserve-symlinks flags are only needed in workspaces where Node cannot resolve an ancestor directory due to filesystem sandboxing.

For development, edit modem adapters in `src/protocols.js`, microphone capture in `src/capture.js`, and UI behavior in `src/app.js`, then regenerate the embedded scripts:

```powershell
node --preserve-symlinks --preserve-symlinks-main scripts/embed-modems.cjs
```

The MT63 binary, license, and source provenance are in [vendor/mt63/NOTICE.md](vendor/mt63/NOTICE.md). The generated HTML embeds the runtime so it remains a portable single-file application.

`tests/browser-protocols.cjs` exercises the actual UI, WAV export, receive callbacks, preview, and protocol switching. Run it with Node against an isolated Chrome instance started with `--headless --remote-debugging-port=9227 --autoplay-policy=no-user-gesture-required --disable-popup-blocking --user-data-dir=<temporary-profile> about:blank`. It first verifies real AudioWorklet capture with a synthetic constant signal across a 1.2-second page stall. The protocol tests then substitute a silent media stream and supply generated WAV samples to the receive handler, verify received pages in new tabs, exercise the blocked-tab fallback, and ensure repeated packets do not reopen tabs; the test never requests the real microphone and closes that browser when finished. It verifies browser integration, not an over-the-air link.

`node --preserve-symlinks --preserve-symlinks-main tests/browser-mt63-realtime.cjs` uses the same isolated browser setup for a full real-time transmission of `hello-fm.html` (about two minutes). It feeds the generated WAV through an independently clocked MediaStream into the actual receive UI, checks all eight packets, and checks capture against wall time beyond the 30-second transition. Add `--compare-legacy` to also report the old muted-output graph's results. It uses synthetic audio without physical microphone or speaker access and closes the browser when finished.
