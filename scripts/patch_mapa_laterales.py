"""Agrega al plano de public/index.html los laterales (01L, 02L, 03L, 04L por segmento), el bloque 08R
(máquina de cables) y las góndolas 12A y 13A, tomando el dibujo del SVG exportado y editado a mano.

Uso (desde la carpeta del proyecto):
    python -X utf8 scripts/patch_mapa_laterales.py RUTA/Mapa_tienda_Calle80_laterales.svg

Qué hace sobre el módulo del plano (línea con "paso:5,nx:"):
- Inserta los rect g-<id> en #gondolas y las etiquetas l-<id> en #etiquetas.
- Registra cada id como destino recorrible: ids, caras, anclas (celda libre de la grilla más cercana
  a la cara que da al pasillo), fusionados y muebles.
- Bloquea en la grilla las celdas de la máquina de cables (08R).
- Amplía el viewBox para que se vean los laterales que quedan sobre los muros.
Es idempotente: si el id ya existe en el plano, no lo vuelve a agregar.
"""
import base64
import json
import re
import sys
from collections import deque
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / 'public' / 'index.html'
NS = '{http://www.w3.org/2000/svg}'

# id -> caras que dan al pasillo (la ruta llega a la celda libre frente a esa cara)
NUEVOS = {'01l': ['este'], '08r': ['norte', 'oeste', 'este'], '12a': ['oeste'], '13a': ['este']}
NUEVOS.update({f'02l-{i}': ['sur'] for i in (1, 2, 3)})
NUEVOS.update({f'03l-{i}': ['oeste'] for i in range(1, 7)})
NUEVOS.update({f'04l-{i}': ['norte'] for i in range(1, 8)})
BLOQUEAR = ['08r']                       # muebles que ocupan piso recorrible
MUEBLES_REF = ['12a', '13a', '08r']      # además, referencias para las indicaciones
VIEWBOX_PLANO = '[-52,-14,1426.3,1763.7]'


def node(e):
    tag = e.tag.replace(NS, '')
    attrs = {k: v for k, v in e.attrib.items()}
    kids = [node(k) for k in e]
    if (e.text or '').strip():
        kids.insert(0, e.text.strip())
    return [tag, attrs, kids]


def main():
    svg = ET.parse(sys.argv[1]).getroot()
    lines = HTML.read_text(encoding='utf8').split('\n')
    li = next(i for i, l in enumerate(lines) if 'paso:5,nx:' in l)
    s = lines[li]

    ids_m = re.search(r'\],ids:\[([^\]]*)\]', s)
    ya = set(json.loads('[' + ids_m.group(1) + ']'))
    # 12A y 13A ya se recorren por la plataforma; solo les faltaba el dibujo (para resaltarlas)
    solo_dibujo = [i for i in ('12a', '13a') if i in ya and f'"g-{i}"' not in s]
    if solo_dibujo:
        js0 = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))
        el = {e.get('id'): e for e in svg.iter() if e.get('id')}
        s = s.replace('["g",{id:"gondolas"},[', '["g",{id:"gondolas"},[' + ''.join(js0(node(el['g-' + i])) + ',' for i in solo_dibujo), 1)
        s = s.replace('["g",{id:"etiquetas"},[', '["g",{id:"etiquetas"},[' + ''.join(js0(node(el['l-' + i])) + ',' for i in solo_dibujo if 'l-' + i in el), 1)
        print(f'  dibujo agregado: {solo_dibujo}')
    nuevos = [i for i in NUEVOS if i not in ya]
    if not nuevos:
        if solo_dibujo:
            lines[li] = s
            HTML.write_text('\n'.join(lines), encoding='utf8')
        print('Laterales ya estaban en el plano.')
        return

    rects, labels = {}, {}
    for e in svg.iter():
        i = e.get('id') or ''
        if e.tag == NS + 'rect' and i.startswith('g-') and i[2:] in nuevos:
            rects[i[2:]] = e
        if e.tag == NS + 'g' and i.startswith('l-') and i[2:] in nuevos:
            labels[i[2:]] = e
    falta = [i for i in nuevos if i not in rects]
    if falta:
        sys.exit(f'El SVG no trae el dibujo de: {falta}')

    # --- grilla ---
    g = re.search(r'paso:(\d+),nx:(\d+),ny:(\d+),x0:([\d.]+),y0:([\d.]+),margen:\d+,bits:"([^"]+)"', s)
    paso, nx, ny, x0, y0 = int(g[1]), int(g[2]), int(g[3]), float(g[4]), float(g[5])
    bits = bytearray(base64.b64decode(g[6]))
    def blq(r, c):
        return not (0 <= r < ny and 0 <= c < nx) or (bits[(r * nx + c) >> 3] >> (7 - ((r * nx + c) & 7))) & 1
    def set_blq(r, c):
        k = r * nx + c
        bits[k >> 3] |= 1 << (7 - (k & 7))

    bbox = {}
    for i in nuevos:
        e = rects[i]
        x, y, w, h = (float(e.get(k)) for k in ('x', 'y', 'width', 'height'))
        bbox[i] = [round(x, 2), round(y, 2), round(x + w, 2), round(y + h, 2)]
    for i in BLOQUEAR:
        if i in bbox:
            a = bbox[i]
            for r in range(int((a[1] - y0) // paso), int((a[3] - y0) // paso) + 1):
                for c in range(int((a[0] - x0) // paso), int((a[2] - x0) // paso) + 1):
                    if 0 <= r < ny and 0 <= c < nx:
                        set_blq(r, c)

    # componente recorrible desde la entrada
    o = re.search(r'celda_origen:\[(\d+),(\d+)\]', s)
    start = (int(o[1]), int(o[2]))
    seen = {start}
    q = deque([start])
    while q:
        r, c = q.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (r + dr, c + dc)
            if n not in seen and not blq(*n):
                seen.add(n)
                q.append(n)

    def ancla(b, cara):
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        px, py = {'oeste': (b[0], cy), 'este': (b[2], cy), 'norte': (cx, b[1]), 'sur': (cx, b[3])}[cara]
        best, bd = None, 1e18
        for (r, c) in seen:
            x, y = x0 + (c + .5) * paso, y0 + (r + .5) * paso
            lado = {'oeste': x < b[0], 'este': x > b[2], 'norte': y < b[1], 'sur': y > b[3]}[cara]
            if not lado:
                continue
            d = (x - px) ** 2 + (y - py) ** 2
            if d < bd:
                best, bd = (r, c), d
        return best, bd ** .5

    caras, anclas = [], []
    for i in nuevos:
        for cara in NUEVOS[i]:
            a, d = ancla(bbox[i], cara)
            if a is None or d > 90:
                print(f'  {i}:{cara} sin celda libre cercana (d={d:.0f}), se omite')
                continue
            caras.append({'mueble': i, 'cara': cara, 'bbox': bbox[i], 'visibles': [i]})
            anclas.append([i, cara, a[0], a[1]])
            print(f'  {i}:{cara} ancla {a} a {d:.0f} u')

    js = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))
    # --- insertar datos ---
    s = s.replace(g[6], base64.b64encode(bytes(bits)).decode(), 1)
    s = s.replace('caras:[', 'caras:[' + ''.join(js(c) + ',' for c in caras), 1)
    s = s.replace('anclas:[', 'anclas:[' + ''.join(js(a) + ',' for a in anclas), 1)
    s = s.replace(ids_m.group(0), '],ids:[' + ids_m.group(1) + ',' + ','.join(js(i) for i in nuevos) + ']', 1)
    s = s.replace('fusionados:{', 'fusionados:{' + ''.join(f'{js(i)}:{js(bbox[i])},' for i in nuevos), 1)
    s = s.replace('muebles:[', 'muebles:[' + ''.join(js({'v': i, 'bbox': bbox[i]}) + ',' for i in MUEBLES_REF if i in nuevos), 1)
    s = re.sub(r'viewBox:\[-14,-14,1356\.3,1763\.7\]', 'viewBox:' + VIEWBOX_PLANO, s, count=1)
    # --- dibujo ---
    gi = '["g",{id:"gondolas"},['
    ei = '["g",{id:"etiquetas"},['
    assert gi in s and ei in s, 'no encontré #gondolas o #etiquetas en el árbol del plano'
    s = s.replace(gi, gi + ''.join(js(node(rects[i])) + ',' for i in nuevos), 1)
    s = s.replace(ei, ei + ''.join(js(node(labels[i])) + ',' for i in nuevos if i in labels), 1)

    lines[li] = s
    HTML.write_text('\n'.join(lines), encoding='utf8')
    print(f'OK: {len(nuevos)} muebles nuevos en el plano, {len(anclas)} anclas.')


if __name__ == '__main__':
    main()
