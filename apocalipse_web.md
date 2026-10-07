## Context

Build a framework-free web tool to send an HTML page or ZIP containing HTML pages and local assets over a small FM transmitter as AX.25 audio, then recover it from an FM receiver's audio through a browser microphone and show the webpage. Transfers are one-way and unencrypted. Aim to deliver one self-contained HTML file that opens by double-clicking, with no server, installation, or Dire Wolf dependency. This workspace contains no application yet.

## Implementation Steps

1. Create unit tests in plain JavaScript for HTML/ZIP import, chunk reassembly, AX.25 UI framing and FCS, 1200-baud AFSK encoding and decoding, damaged or missing packets, and preview links. Run them immediately and confirm they fail for the expected missing implementation before changing production code.
2. Check the target browser's microphone and audio APIs from a double-clicked `file://` page. Keep all application code inline so local-file loading restrictions do not require a server; document any browser-specific limitation found.
3. In a single HTML file, implement HTML/ZIP import, safe relative paths, an entry page, and bounded file sizes. Split files and a manifest into numbered, integrity-checked chunks that fit AX.25 UI frames.
4. Generate playable or downloadable 1200-baud AFSK audio from those frames using browser APIs. Repeat the transfer so the receiver can recover dropped packets or join late.
5. With microphone permission, capture the receiver's audio, decode and validate frames, combine chunks across repeats, show reception progress, and reconstruct the files.
6. Add upload, transmit, receive, and preview controls in the same HTML file. Show the selected recovered page and its local assets and links in a sandboxed preview.
7. Run all relevant tests again and confirm they pass. Double-click the HTML file and verify an HTML page and a multi-file ZIP end to end with the actual radios, including audio levels and dropped packets. Use Dire Wolf only as an optional interoperability check if it helps diagnose decoding.
