'use strict';

/*
 * Small HTTPS download helper shared by the provisioning scripts. Follows
 * redirects (GitHub release assets redirect to a CDN) and writes atomically
 * enough for our purposes: a failed transfer removes the partial file so the
 * next run retries cleanly.
 */

const fs = require('fs');
const https = require('https');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'adrenaline-provisioning' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.rmSync(dest, { force: true });
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(new Error(`GET ${url} -> ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (e) => { file.close(); reject(e); });
  });
}

module.exports = { download };
