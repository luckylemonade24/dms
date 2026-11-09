import os, json, hashlib
from PIL import Image
from aseprite import Sprite

# 完全按你的要求，从底到顶排好，红眼在卡图之后
DEFAULT_LAYER_ORDER = [
    '发光', '背光', '强光', '微光', '特别典藏',
    '描述text',
    '伤害图标', '伤害图标text', '血量图标', '血量text',
    '卡图', 
    '红眼',        # <--- 在卡图后面，覆盖卡图
    '何意味', 
    '卡图text', 
    '卡等级text', '卡名text', '卡类', '卡编号',
    '滤镜'
]

FIXED_LAYERS = {'背景1', '背景2', '卡框', '卡名', '描述', '护符', '护符 复制'}
FULL_DIR     = 'full_cards'
MAX_AUTO_SCALE = 8
MIN_OUT_SIZE   = 2

BLEND_MAP = {
    0: 'normal', 1: 'multiply', 2: 'screen', 3: 'overlay',
    4: 'darken', 5: 'lighten', 6: 'color-dodge', 7: 'color-burn',
    8: 'hard-light', 9: 'soft-light', 10: 'difference', 11: 'exclusion',
    12: 'hue', 13: 'saturation', 14: 'color', 15: 'luminosity'
}
BLEND_CODE = {v: k for k, v in BLEND_MAP.items()}

def probe_size(pixels):
    w = 0
    while True:
        try: pixels[w, 0]; w += 1
        except IndexError: break
    h = 0
    while True:
        try: pixels[0, h]; h += 1
        except IndexError: break
    return w, h

def cel_img(cel, layer_opacity=255):
    w, h = probe_size(cel.pixels)
    if w == 0 or h == 0: return None
    im = Image.new('RGBA', (w, h))
    cel_opacity = getattr(cel, 'opacity', 255)
    final_opacity = (layer_opacity * cel_opacity) / 255.0
    
    for y in range(h):
        for x in range(w):
            p = tuple(cel.pixels[x, y])
            new_alpha = int(p[3] * (final_opacity / 255.0))
            im.putpixel((x, y), (p[0], p[1], p[2], new_alpha))
    return im

def _all_uniform(pixels, w, h, k):
    for by in range(0, h, k):
        for bx in range(0, w, k):
            c = pixels[bx, by]
            for yy in range(by, by + k):
                for xx in range(bx, bx + k):
                    p = pixels[xx, yy]
                    if c[3] == 0 and p[3] == 0: continue
                    if abs(p[0]-c[0]) > 1 or abs(p[1]-c[1]) > 1 or abs(p[2]-c[2]) > 1 or abs(p[3]-c[3]) > 1:
                        return False
    return True

def detect_scale(img):
    w, h = img.size
    if w < 4 or h < 4: return 1
    pixels = img.load()
    max_k = min(MAX_AUTO_SCALE, w, h)
    for k in range(max_k, 1, -1):
        if w % k != 0 or h % k != 0: continue
        if _all_uniform(pixels, w, h, k): return k
    return 1

def get_blend_code(layer):
    bm = getattr(layer, 'blend_mode', 0)
    if isinstance(bm, str):
        bm = bm.lower().replace(' ', '-')
    else:
        bm = BLEND_MAP.get(bm, 'normal')
    return BLEND_CODE.get(bm, 0)

def add_frame(im, prefix, card, reports):
    ow, oh = im.width, im.height
    scale = detect_scale(im)
    if scale > 1 and (ow % scale != 0 or oh % scale != 0): scale = 1
    if scale > 1 and (ow // scale < MIN_OUT_SIZE or oh // scale < MIN_OUT_SIZE): scale = 1

    reports.append({'layer': prefix, 'scale': scale, 'w': ow, 'h': oh})

    if scale > 1:
        sw, sh = ow // scale, oh // scale
        im_small = im.resize((sw, sh), Image.NEAREST)
        print(f'    [{card}] {prefix}: {ow}x{oh} → {sw}x{sh} (缩小 {scale}x)')
    else:
        sw, sh = ow, oh
        im_small = im
        print(f'    [{card}] {prefix}: {ow}x{oh} (保持原尺寸)')

    hh = hashlib.md5(im_small.tobytes()).hexdigest()[:8]
    if hh not in fid_map:
        fid_map[hh] = len(frames)
        frames.append([sw, sh, ow, oh, scale])
        im_small.save(f'frames/{hh}.png', 'PNG')
    return fid_map[hh]

def main():
    global frames, fid_map
    os.makedirs('frames', exist_ok=True)
    frames, fid_map, cards, full, reports = [], {}, {}, {}, []
    files = sorted(f for f in os.listdir('.') if f.lower().endswith(('.aseprite', '.ase')))

    # 只收集存在的可见层
    global_layers_set = set()
    for fn in files:
        sp = Sprite.open(fn)
        for l in sp.layers:
            if not getattr(l, 'is_group', False) and getattr(l, 'visible', True):
                if l.name not in FIXED_LAYERS:
                    global_layers_set.add(l.name)

    # 严格按照我们手写的 DEFAULT_LAYER_ORDER 排序，没有任何自动推导干扰
    final_layers = [name for name in DEFAULT_LAYER_ORDER if name in global_layers_set]
    
    # 如果还有没写在列表里的可见层，加到最后
    for name in sorted(global_layers_set):
        if name not in final_layers: 
            final_layers.append(name)
            
    print(f'== 强制按固定顺序识别（共 {len(final_layers)} 层） ==')
    for i, l in enumerate(final_layers):
        print(f'  {i+1}. {l}')
    print('=======================================================\n')

    for idx, fn in enumerate(files, 1):
        card = os.path.splitext(fn)[0]
        sp = Sprite.open(fn)
        print(f'[{idx}/{len(files)}] {card}')

        nums = []
        for layer_name in final_layers:
            target = next((l for l in sp.layers if not getattr(l, 'is_group', False) and l.name == layer_name), None)
            
            if target is None or not getattr(target, 'visible', True):
                nums.extend([-1, 0, 0, 0])
                continue

            cel = sp.frames[0].cel(target)
            if cel is None or cel.pixels is None:
                nums.extend([-1, 0, 0, 0])
                continue

            layer_op = getattr(target, 'opacity', 255)
            im = cel_img(cel, layer_op)
            if im is None:
                nums.extend([-1, 0, 0, 0])
                continue

            fid = add_frame(im, layer_name, card, reports)
            blend_code = get_blend_code(target)
            nums.extend([fid, cel.x, cel.y, blend_code])

        cards[card] = nums
        print()

    if os.path.isdir(FULL_DIR):
        print(f'== 提取整卡图片 ==')
        for fn in sorted(os.listdir(FULL_DIR)):
            if not fn.lower().endswith(('.png', '.webp', '.jpg', '.jpeg')): continue
            card = os.path.splitext(fn)[0]
            im = Image.open(os.path.join(FULL_DIR, fn)).convert('RGBA')
            print(f'  [{card}] 整卡: 原始 {im.width}x{im.height}')
            fid = add_frame(im, 'full', card, reports)
            full[card] = fid

    with open('mid.json', 'w', encoding='utf-8') as f:
        json.dump({'frames': frames, 'cards': cards, 'full': full}, f, ensure_ascii=False, separators=(',', ':'))
    with open('fid_map.json', 'w', encoding='utf-8') as f:
        json.dump(fid_map, f, ensure_ascii=False, separators=(',', ':'))
    
    by_layer = {}
    for r in reports:
        s = by_layer.setdefault(r['layer'], {'n': 0, 'scaled': 0, 'orig': 0, 'stor': 0})
        s['n'] += 1; s['orig'] += r['w'] * r['h']
        s['stor'] += (r['w'] // r['scale']) * (r['h'] // r['scale'])
        if r['scale'] > 1: s['scaled'] += 1

    print(f'\n{"="*65}\nframes: {len(frames)}  cards: {len(cards)}  full: {len(full)}\n{"="*65}')
    print(f'{"图层":<12}{"总卡数":>8}{"缩小数":>8}{"原始像素":>14}{"存储像素":>14}{"比例":>8}')
    for layer in final_layers:
        s = by_layer.get(layer, {'n':0, 'scaled':0, 'orig':0, 'stor':0})
        if s['n'] == 0: continue
        ratio = 100 * s['stor'] / max(s['orig'], 1)
        print(f'{layer:<12}{s["n"]:>8}{s["scaled"]:>8}{s["orig"]:>14,}{s["stor"]:>14,}{ratio:>7.1f}%')
    print(f'{"-"*65}\n{"总计":<12}{"":>8}{"":>8}{sum(s["orig"] for s in by_layer.values()):>14,}{sum(s["stor"] for s in by_layer.values()):>14,}')
    print(f'👉 前端 LAYERS_N 需改为: {len(final_layers)}')

if __name__ == '__main__':
    main()
