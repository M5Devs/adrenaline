'use strict';

/*
 * Minimal, dependency-free single-member ZIP extractor.
 *
 * Used to pull one file out of a release archive (the Neutralinojs standalone
 * runtime, the WebView2 SDK header) without depending on `unzip` being present —
 * the Windows runners have none — or shelling out to PowerShell. Members are
 * located via the central directory and inflated with Node's built-in zlib.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/** Extract `memberName` from the zip at `zipPath` to `outPath`. */
function extractZipMember(zipPath, memberName, outPath) {
  const buf = fs.readFileSync(zipPath);

  // End Of Central Directory record: signature 0x06054b50, scanned from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: ' + zipPath);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  let dataOffset = -1, compSize = -1, method = -1;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) break;
    const m = buf.readUInt16LE(cdOffset + 10);
    const csize = buf.readUInt32LE(cdOffset + 20);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localOff = buf.readUInt32LE(cdOffset + 42);
    const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen);
    if (name === memberName) {
      method = m;
      compSize = csize;
      // The local header repeats the name/extra lengths; the payload starts after.
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      dataOffset = localOff + 30 + lNameLen + lExtraLen;
      break;
    }
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  if (dataOffset < 0) throw new Error(memberName + ' not found in ' + zipPath);

  const raw = buf.subarray(dataOffset, dataOffset + compSize);
  const out = method === 0 ? raw : zlib.inflateRawSync(raw);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out);
}

module.exports = { extractZipMember };
