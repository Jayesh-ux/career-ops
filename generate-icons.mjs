import fs from 'fs';
import zlib from 'zlib';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData));
  return Buffer.concat([len, typeData, crc]);
}

function makePNG(size) {
  const ihdr = makeChunk('IHDR', Buffer.from([
    (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff,
    (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff,
    8, 2, 0, 0, 0
  ]));

  let raw = Buffer.alloc(0);
  for (let y = 0; y < size; y++) {
    raw = Buffer.concat([raw, Buffer.from([0])]);
    for (let x = 0; x < size; x++) {
      raw = Buffer.concat([raw, Buffer.from([41, 128, 255])]);
    }
  }

  const compressed = zlib.deflateSync(raw);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), ihdr, idat, iend]);
}

const sizes = {mdpi:48, hdpi:72, xhdpi:96, xxhdpi:144, xxxhdpi:192};
for (const [density, size] of Object.entries(sizes)) {
  const png = makePNG(size);
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
    const path = `/root/career-ops/career-ops-app/app/src/main/res/mipmap-${density}/${name}`;
    fs.writeFileSync(path, png);
    console.log(`Created ${path} (${png.length} bytes)`);
  }
}
