"""Agrega al plano de public/index.html la salida a Patio Constructor como destino recorrible ("patio").

La salida está en el muro derecho de la tienda (en pantalla), entre Plomería y Ferretería: el pasillo transversal
que termina justo arriba del lateral 04L · Ferretería. Las ubicaciones con prefijo P (01P, 02P…, Zona P) se guían
hasta ese punto y la app le dice al cliente "Dirígete a Patio Constructor".

Uso (desde la carpeta del proyecto):
    python -X utf8 scripts/patch_patio.py
Es idempotente: si "patio" ya está en el plano, no hace nada.
"""
import base64
import json
import re
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / 'frontend' / 'public' / 'index.html'
ID = 'patio'
# Puerta dibujada sobre el muro (coordenadas del plano) y punto de la salida al que llega la ruta
BBOX = [1224.3, 1556.5, 1290.0, 1576.5]  # mismo alto y fila que los laterales 04L
SALIDA = (1257.0, 1545.0)
CARA = 'este'


def main():
    lines = HTML.read_text(encoding='utf8').split('\n')
    li = next(i for i, l in enumerate(lines) if 'paso:5,nx:' in l)
    s = lines[li]
    ids_m = re.search(r'\],ids:\[([^\]]*)\]', s)
    if f'"{ID}"' in ids_m.group(1):
        print('Patio Constructor ya estaba en el plano.')
        return

    g = re.search(r'paso:(\d+),nx:(\d+),ny:(\d+),x0:([\d.]+),y0:([\d.]+),margen:\d+,bits:"([^"]+)"', s)
    paso, nx, ny, x0, y0 = int(g[1]), int(g[2]), int(g[3]), float(g[4]), float(g[5])
    bits = base64.b64decode(g[6])
    blq = lambda r, c: not (0 <= r < ny and 0 <= c < nx) or (bits[(r * nx + c) >> 3] >> (7 - ((r * nx + c) & 7))) & 1

    o = re.search(r'celda_origen:\[(\d+),(\d+)\]', s)
    start = (int(o[1]), int(o[2]))
    seen, q = {start}, deque([start])
    while q:
        r, c = q.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (r + dr, c + dc)
            if n not in seen and not blq(*n):
                seen.add(n)
                q.append(n)
    # celda recorrible más cercana a la salida (filas = y del plano, columnas = x)
    px, py = SALIDA
    best = min(seen, key=lambda rc: (x0 + (rc[1] + .5) * paso - px) ** 2 + (y0 + (rc[0] + .5) * paso - py) ** 2)
    d = ((x0 + (best[1] + .5) * paso - px) ** 2 + (y0 + (best[0] + .5) * paso - py) ** 2) ** .5
    if d > 40:
        raise SystemExit(f'No hay celda recorrible cerca de la salida (d={d:.0f})')
    print(f'  ancla {best} a {d:.0f} u de la salida')

    js = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))
    cara = {'mueble': ID, 'cara': CARA, 'bbox': BBOX, 'visibles': [ID]}
    s = s.replace('caras:[', 'caras:[' + js(cara) + ',', 1)
    s = s.replace('anclas:[', 'anclas:[' + js([ID, CARA, best[0], best[1]]) + ',', 1)
    s = s.replace(ids_m.group(0), '],ids:[' + ids_m.group(1) + ',' + js(ID) + ']', 1)
    s = s.replace('fusionados:{', 'fusionados:{' + js(ID) + ':' + js(BBOX) + ',', 1)
    # dibujo: con el mismo estilo de un lateral; el CSS la pone amarilla solo cuando es destino
    x, y, x2, y2 = BBOX
    rect = ['rect', {'id': f'g-{ID}', 'x': f'{x}', 'y': f'{y}', 'width': f'{x2 - x:.1f}', 'height': f'{y2 - y:.1f}', 'rx': '7', 'fill': '#D9E4F1'}, []]
    gi = '["g",{id:"gondolas"},['
    assert gi in s
    s = s.replace(gi, gi + js(rect) + ',', 1)
    lines[li] = s
    HTML.write_text('\n'.join(lines), encoding='utf8')
    print('OK: salida a Patio Constructor agregada al plano.')


if __name__ == '__main__':
    main()
