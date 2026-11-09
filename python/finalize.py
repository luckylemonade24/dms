import json, glob

with open('mid.json',    encoding='utf-8') as f: mid     = json.load(f)
with open('fid_map.json', encoding='utf-8') as f: fid_map = json.load(f)

def normalize(key):
    name = key.rsplit('/', 1)[-1]
    for ext in ('.png', '.webp', '.jpg', '.jpeg'):
        if name.lower().endswith(ext):
            return name[:-len(ext)]
    return name

atlases = []
tex_lookup = {}
for idx, tex_file in enumerate(sorted(glob.glob('texture*.json'))):
    with open(tex_file, encoding='utf-8') as f: tex = json.load(f)
    meta = tex.get('meta', {})
    aw = meta.get('size', {}).get('w', 4096)
    ah = meta.get('size', {}).get('h', 4096)
    url = meta.get('image', tex_file.replace('.json', '.webp'))
    atlases.append([url, aw, ah])
    for raw_key, v in tex['frames'].items():
        key = normalize(raw_key)
        fr = v['frame']
        tex_lookup[key] = [fr['x'], fr['y'], fr['w'], fr['h'], idx]

fid_rev = {v: k for k, v in fid_map.items()}
frames = mid['frames']
f_flat = []
for fid in range(len(frames)):
    entry = frames[fid]
    sw, sh, ow, oh, scale = entry[0], entry[1], entry[2], entry[3], entry[4]
    key = fid_rev.get(fid)
    if key and key in tex_lookup:
        x, y, tw, th, aidx = tex_lookup[key]
        f_flat.extend([x, y, tw, th, aidx, scale])
    else:
        f_flat.extend([0, 0, sw, sh, 0, scale])

c_flat = []
for card_name, nums in mid['cards'].items():
    c_flat.append(card_name)
    # 步长 4
    for i in range(0, len(nums), 4):
        c_flat.extend(nums[i:i+4])

u_flat = []
for card_name, fid in mid['full'].items():
    u_flat.extend([card_name, fid, 0, 0])

out = {'a': atlases, 'f': f_flat, 'c': c_flat, 'u': u_flat}

with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

size = len(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print(f'atlases: {len(atlases)}  frames: {len(frames)}  cards: {len(mid["cards"])}')
print(f'data.json: {size} bytes ({size/1024:.1f} KB)')
