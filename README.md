# गीता ज्ञान · Gita Gyan

Password-protected Bhagavad Gita reader: Sanskrit, IAST transliteration, Hindi bhavarth (© SKC & CO) and Shri Purohit Swami's English translation (1935), with an AI study companion.

- `index.html` is the entry page: name + password login, then a choice of **Gita** or **Income Tax Calculator**
- `gita.html` is the public reader; `tax.html` is the Income Tax Calculator (FY 2025-26 / AY 2026-27, old vs new regime, computation of income with Print / Save / Download PDF + CSV). Both open only after the same login and otherwise send visitors back to `index.html`
- `admin.html` is the reader with editing tools; **Publish** commits here through the GitHub API
- `assets/tax-core.js` holds the tax maths (tested with `npm test`, Node 18+); `assets/tax.js` is the calculator page; `assets/vendor/jspdf.umd.min.js` is jsPDF 4.2.1 (MIT) for the PDF download
- `data/gita.enc` holds the content, encrypted (AES-256-GCM, key derived from the access password with PBKDF2)
- `worker/worker.js` is the Cloudflare Worker behind the "Gita Sakha" agent

Hindi bhavarth © SKC & CO. All rights reserved.
