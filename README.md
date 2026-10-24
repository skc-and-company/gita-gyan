# गीता ज्ञान · Gita Gyan

Password-protected Bhagavad Gita reader: Sanskrit, IAST transliteration, Hindi bhavarth (© SKC & CO) and Shri Purohit Swami's English translation (1935), with an AI study companion.

- `index.html` is the public reader (name + password)
- `admin.html` is the same site with editing tools; **Publish** commits here through the GitHub API
- `data/gita.enc` holds the content, encrypted (AES-256-GCM, key derived from the access password with PBKDF2)
- `worker/worker.js` is the Cloudflare Worker behind the "Gita Sakha" agent

Hindi bhavarth © SKC & CO. All rights reserved.
