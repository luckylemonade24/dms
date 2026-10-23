const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

(async () => {
  // 确保你的图标文件路径正确
  const src = path.join(__dirname, '图标', '桌面图标.jpg.'); 
  if (!fs.existsSync(src)) {
      console.log('⚠️ 未找到图标源文件: 图标/桌面图标.jpg，跳过图标生成，使用默认图标');
      return;
  }
  const sizes = [16, 32, 48, 64, 128, 256];
  const imgs = await Promise.all(sizes.map(s => sharp(src).resize(s, s).png().toBuffer()));
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0,0); hdr.writeUInt16LE(1,2); hdr.writeUInt16LE(sizes.length,4);
  const entries = []; let off = 6 + sizes.length*16;
  for (let i=0;i<sizes.length;i++) {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i]>=256?0:sizes[i],0);
    e.writeUInt8(sizes[i]>=256?0:sizes[i],1);
    e.writeUInt16LE(1,4); e.writeUInt16LE(32,6);
    e.writeUInt32LE(imgs[i].length,8); e.writeUInt32LE(off,12);
    off += imgs[i].length; entries.push(e);
  }
  fs.writeFileSync(path.join(__dirname,'app.ico'), Buffer.concat([hdr,...entries,...imgs]));
  console.log('✅ 图标 app.ico 生成成功');
})().catch(e=>{console.error(e);process.exit(1);});