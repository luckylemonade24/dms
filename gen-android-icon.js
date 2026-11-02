const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = path.join(__dirname, '图标', '桌面图标.jpg');
  if (!fs.existsSync(src)) {
    console.log('⚠️ 未找到图标源文件: 图标/桌面图标.jpg，跳过生成，安卓将使用默认图标');
    return;
  }

  // 安卓标准图标的各个尺寸
  const densities = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192
  };

  for (const [dir, size] of Object.entries(densities)) {
    const targetDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res', `mipmap-${dir}`);
    fs.mkdirSync(targetDir, { recursive: true });
    
    // 用 sharp 缩放并转成 png
    await sharp(src)
      .resize(size, size)
      .png({ compressionLevel: 9, effort: 10, palette: true }) // 极致压缩
      .toFile(path.join(targetDir, 'ic_launcher.png'));
  }
  
  console.log('✅ Android 图标 ic_launcher.png 生成成功');
})().catch(e => { console.error(e); process.exit(1); });