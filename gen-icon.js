const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function rgbaToIcoBmp(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);
  header.writeInt32LE(0, 24);
  header.writeInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  header.writeUInt32LE(0, 36);

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const si = (srcY * size + x) * 4;
      const di = (y * size + x) * 4;
      pixels[di]     = rgba[si + 2];
      pixels[di + 1] = rgba[si + 1];
      pixels[di + 2] = rgba[si];
      pixels[di + 3] = rgba[si + 3];
    }
  }

  const maskRowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRowBytes * size, 0);

  return Buffer.concat([header, pixels, mask]);
}

(async () => {
  const src = path.join(__dirname, '图标', '桌面图标.jpg');
  if (!fs.existsSync(src)) {
    console.log('⚠️ 未找到图标源文件: 图标/桌面图标.jpg，跳过图标生成，使用默认图标');
    return;
  }

  const sizes = [256, 128, 64, 48, 32, 16];
  const entries = [];
  const datas = [];
  let off = 6 + sizes.length * 16;

  for (const s of sizes) {
    let buf;
    if (s === 256) {
      buf = await sharp(src).resize(s, s).png().toBuffer();
    } else {
      const { data } = await sharp(src).resize(s, s).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      buf = rgbaToIcoBmp(data, s);
    }

    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0);
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(off, 12);
    off += buf.length;

    entries.push(e);
    datas.push(buf);
  }

  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0);
  hdr.writeUInt16LE(1, 2);
  hdr.writeUInt16LE(sizes.length, 4);

  fs.writeFileSync(path.join(__dirname, 'app.ico'), Buffer.concat([hdr, ...entries, ...datas]));
  console.log('✅ 图标 app.ico 生成成功');
})().catch(e => { console.error(e); process.exit(1); });