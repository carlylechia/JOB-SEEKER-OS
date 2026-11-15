import zlib from 'node:zlib';

/**
 * Build a minimal, dependency-free ZIP archive (DEFLATE, method 8) from a list
 * of in-memory files. Filenames are sanitised so they cannot escape the archive.
 */
export function createZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = sanitizeEntryName(entry.name);
    const nameBuffer = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(entry.data) >>> 0;
    const compressed = zlib.deflateRawSync(entry.data);
    const uncompressedSize = entry.data.byteLength;
    const compressedSize = compressed.byteLength;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0, 6); // general purpose flag
    localHeader.writeUInt16LE(8, 8); // compression method: DEFLATE
    localHeader.writeUInt16LE(0, 10); // last mod time
    localHeader.writeUInt16LE(0, 12); // last mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(8, 10); // method
    centralHeader.writeUInt16LE(0, 12); // last mod time
    centralHeader.writeUInt16LE(0, 14); // last mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralOffset = offset;
  const centralSize = centralDirectory.length;

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4); // number of this disk
  endOfCentralDirectory.writeUInt16LE(0, 6); // disk with central directory
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralSize, 12);
  endOfCentralDirectory.writeUInt32LE(centralOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function sanitizeEntryName(name: string): string {
  const cleaned = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
  return cleaned || 'file.txt';
}