const encoder = new TextEncoder();

function writeStr(header: Uint8Array, offset: number, maxLen: number, value: string): void {
  header.set(encoder.encode(value).subarray(0, maxLen), offset);
}

function writeOctal(header: Uint8Array, offset: number, fieldLen: number, value: number): void {
  writeStr(header, offset, fieldLen, value.toString(8).padStart(fieldLen - 1, "0"));
}

export function buildTar(files: Array<{ content: string; name: string }>): Uint8Array {
  const blocks: Array<Uint8Array> = [];

  for (const file of files) {
    const contentBytes = encoder.encode(file.content);
    const header = new Uint8Array(512);

    writeStr(header, 0, 100, file.name);
    writeStr(header, 100, 8, "0000644");
    writeStr(header, 108, 8, "0000000");
    writeStr(header, 116, 8, "0000000");
    writeOctal(header, 124, 12, contentBytes.length);
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(0x20, 148, 156); // checksum placeholder (spaces)
    header[156] = 0x30; // typeflag '0' = regular file
    writeStr(header, 257, 6, "ustar");
    writeStr(header, 263, 2, "00");

    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeStr(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);

    const paddedLen = Math.ceil(contentBytes.length / 512) * 512;
    const contentBlock = new Uint8Array(paddedLen);
    contentBlock.set(contentBytes);

    blocks.push(header, contentBlock);
  }

  blocks.push(new Uint8Array(1024)); // end-of-archive marker

  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}
