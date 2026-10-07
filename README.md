# Apocalipse Web

Open [apocalipse.html](apocalipse.html) by double-clicking it. No server, build step, package install, or Dire Wolf is required.

1. Select an `.html` file or a `.zip` containing an HTML page and its local assets. ZIP entries may use stored or DEFLATE compression. Paths must be relative and remain inside the archive. The total reconstructed site, including its manifest, is limited to 256 KiB.
2. Connect computer audio output to the FM transmitter's audio input. Select **Start repeating** and set the audio level conservatively. A full cycle repeats until stopped. **Download WAV** creates one pass for transfers up to ten minutes long.
3. Connect the FM receiver's audio output to a microphone or line input. Select **Start microphone** and grant permission. Watch the level meter and packet progress. Dropped packets can arrive on later cycles.
4. Select **Show received page** when complete. The preview supports local images, stylesheets, fonts, media, and links between HTML pages. Scripts and network resources are blocked in the preview.

The radio link is one way and unencrypted. It uses 1200 baud Bell 202 AFSK, NRZI, and AX.25 UI frames with an FCS. Each transfer has a session ID, numbered chunks, a per-chunk CRC32, and a manifest with per-file CRC32. Files are validated before the preview is enabled.

Modern browsers generally regard `file://` as a secure context for microphone access, though microphone permission is still required and individual browser policies can restrict it. The app uses `ScriptProcessorNode` to keep all code in one local file; this API is deprecated and may eventually be removed. If microphone access is unavailable, the page reports that in the receive panel. These browser constraints are documented by [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [MDN ScriptProcessorNode](https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode).

Run the plain JavaScript tests with:

```powershell
node --preserve-symlinks --preserve-symlinks-main --test tests/core.test.js
```

The preserve-symlinks flags are only needed in workspaces where Node cannot resolve an ancestor directory due to filesystem sandboxing. Hardware radio levels and performance still need an end-to-end test with the actual transmitter and receiver.
