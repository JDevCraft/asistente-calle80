"""Genera el índice de destinos (backend/api/_destinos.json) a partir del Excel del catálogo y del plano.

Uso (desde la carpeta del proyecto):
    python -X utf8 scripts/build_destinos.py

Volver a correr cada vez que cambie el Excel o el plano (frontend/public/js/ruta.js).

Qué produce:
- pasillos: cada pasillo del catálogo, si está dibujado en el mapa y sus vecinos (pasillos contiguos).
  Dos pasillos dibujados son vecinos si sus góndolas están a GAP_MAX o menos en el plano.
  Los pasillos sin dibujo son vecinos de los de su misma letra cuyo número difiere en 2 o menos.
  Si existe data/pasillo_destino.json (tabla manual del equipo de la tienda), sus grupos mandan.
- tipos: por tipo de producto, SKUs por conjunto y pasillo.
- conjs: por conjunto (familia + conjunto), espacio, número de segmento del catálogo de la IA y SKUs por pasillo.
- sinonimos: hoja Sinónimos del Excel.
"""
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / 'data' / 'Segmentacion_Productos_Calle80.xlsx'
HTML = ROOT / 'frontend' / 'public' / 'js' / 'ruta.js'  # bundle del mapa: contiene el plano (bboxes e ids)
MANUAL = ROOT / 'data' / 'pasillo_destino.json'
LATERALES = ROOT / 'data' / 'laterales.json'
OUT = ROOT / 'backend' / 'api' / '_destinos.json'
GAP_MAX = 32.0          # unidades del plano entre góndolas para considerarlas contiguas
FAMILIAS_FUERA = {'MISCELANEOS'}  # bonos, donaciones, estibas: no son productos


def norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.upper().strip()


def aisle_key(p):
    return p.strip().lower()


def parse_map():
    html = HTML.read_text(encoding='utf8')
    muebles = re.findall(r'\{v:"([^"]+)",bbox:\[([^\]]+)\]\}', html)
    boxes = defaultdict(list)
    for v, bb in muebles:
        m = re.match(r'^(\d\d[a-z])(?:-[a-z])?$', v, re.I)
        if not m:
            continue
        boxes[m.group(1).lower()].append([float(x) for x in bb.split(',')])
    return boxes


def map_ids():
    """Destinos recorribles del plano (lista ids del módulo del mapa)."""
    html = HTML.read_text(encoding='utf8')
    m = re.search(r'\],ids:\[([^\]]*)\]', html)
    return set(json.loads('[' + m.group(1) + ']')) if m else set()


def load_laterales():
    """código de lateral ('02l') -> segmentos [{id, nombre, familias, modulos}]."""
    if not LATERALES.exists():
        return {}
    d = json.loads(LATERALES.read_text(encoding='utf8'))['laterales']
    return {k.lower(): [{**sg, 'familias': {norm(f) for f in sg.get('familias', [])}} for sg in v] for k, v in d.items()}


def segmento_lateral(segs, fam, modulo):
    """Familia primero (el grupo del producto), luego el rango de módulos, luego el rango más cercano."""
    if len(segs) == 1:
        return segs[0]['id']
    f = [sg for sg in segs if norm(fam) in sg['familias']]
    if len(f) == 1:
        return f[0]['id']
    if modulo is None:
        return None
    r = [sg for sg in segs if sg['modulos'] and sg['modulos'][0] <= modulo <= sg['modulos'][1]]
    if r:
        return r[0]['id']
    dist = lambda sg: min(abs(modulo - sg['modulos'][0]), abs(modulo - sg['modulos'][1]))
    con = [sg for sg in segs if sg['modulos']]
    return min(con, key=dist)['id'] if con else None


def gap(a, b):
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return (dx * dx + dy * dy) ** 0.5


def split_aisle(a):
    m = re.match(r'^(\d+)([a-z]+)$', a)
    return (int(m.group(1)), m.group(2)) if m else (None, None)


def main():
    wb = openpyxl.load_workbook(XLSX, read_only=True)

    # --- SKUs ---
    ws = wb['SKUs segmentados']
    rows = ws.iter_rows(values_only=True)
    head = [norm(h) for h in next(rows)]
    col = {h: i for i, h in enumerate(head)}
    i_fam, i_conj, i_esp, i_tipo, i_pas = (col['FAMILIA'], col['CONJUNTO'], col['ESPACIO / USO'],
                                           col['TIPO DE PRODUCTO'], col['PASILLO(S)'])
    i_ub = col['UBICACION(ES)']
    LAT = load_laterales()
    lat_n = defaultdict(float)   # segmento -> SKUs
    lat_sin = defaultdict(int)   # lateral sin segmento -> SKUs
    tipos = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))  # tipo -> conjKey -> aisle -> n
    conj_aisles = defaultdict(lambda: defaultdict(float))
    conj_info = {}
    all_aisles = set()
    n_skus = 0
    for r in rows:
        fam, conj, esp, tipo, pas = r[i_fam], r[i_conj], r[i_esp], r[i_tipo], r[i_pas]
        if not fam or not conj or fam in FAMILIAS_FUERA:
            continue
        n_skus += 1
        key = f'{fam}>{conj}'
        conj_info.setdefault(key, esp or 'Otros')
        aisles = [aisle_key(p) for p in str(pas or '').split(',') if p.strip()]
        # Laterales: el módulo de la ubicación (02L23 → módulo 23) y la familia dicen a qué segmento va
        if LAT and any(a in LAT for a in aisles):
            ubs = [u.strip().lower() for u in str(r[i_ub] or '').split(',') if u.strip()]
            out = []
            for a in aisles:
                if a not in LAT:
                    out.append(a)
                    continue
                mods = [int(u[len(a):len(a) + 2]) for u in ubs if u.startswith(a) and u[len(a):len(a) + 2].isdigit()]
                segs = {segmento_lateral(LAT[a], fam, m) for m in (mods or [None])} - {None}
                if not segs:
                    lat_sin[a] += 1
                    out.append(a)
                out.extend(sorted(segs))
            aisles = list(dict.fromkeys(out))
            for a in aisles:
                if any(a == sg['id'] for v in LAT.values() for sg in v):
                    lat_n[a] += 1 / len(aisles)
        if not aisles:
            continue
        w = 1.0 / len(aisles)
        for a in aisles:
            all_aisles.add(a)
            conj_aisles[key][a] += w
            if tipo:
                tipos[norm(tipo)][key][a] += w

    # --- Segmentos del catálogo de la IA (mismo orden que backend/api/_catalog.js) ---
    segs = json.loads((ROOT / 'frontend' / 'public' / 'ai.json').read_text(encoding='utf8'))['segs']
    seg_id = {f'{s[0]}>{s[1]}': i for i, s in enumerate(segs)}

    # --- Espacio validado / nombre para cliente (si categorías ya lo llenó) ---
    names = {}
    ws = wb['Conjunto → Espacio']
    it = ws.iter_rows(values_only=True)
    next(it)
    for fam, conj, esp, _n, esp_ok, nombre in it:
        if not fam or not conj:
            continue
        key = f'{fam}>{conj}'
        if esp_ok:
            conj_info[key] = esp_ok
        if nombre:
            names[key] = str(nombre)

    # --- Sinónimos ---
    sin = {}
    ws = wb['Sinónimos']
    it = ws.iter_rows(values_only=True)
    next(it)
    for w, eq in it:
        if w and eq:
            sin[norm(w)] = [norm(x) for x in str(eq).split(',') if x.strip()]

    # --- Pasillos y vecinos ---
    boxes = parse_map()
    all_aisles |= set(boxes)
    neigh = {a: set() for a in all_aisles}
    lst = sorted(all_aisles)
    for i, a in enumerate(lst):
        na, la = split_aisle(a)
        for b in lst[i + 1:]:
            nb, lb = split_aisle(b)
            if a in boxes and b in boxes:
                ok = min(gap(x, y) for x in boxes[a] for y in boxes[b]) <= GAP_MAX
            else:
                ok = la is not None and la == lb and abs(na - nb) <= 2
            if ok:
                neigh[a].add(b)
                neigh[b].add(a)
    manual = None
    if MANUAL.exists():
        manual = json.loads(MANUAL.read_text(encoding='utf8'))  # {"destinos": {"id": ["19a","20a",...]}}
        for _id, grp in manual.get('destinos', {}).items():
            g = [aisle_key(x) for x in grp]
            for a in g:
                neigh.setdefault(a, set())
            # la tabla manual reemplaza la vecindad calculada de esos pasillos
            for a in g:
                neigh[a] = {b for b in neigh[a] if b in g} | {b for b in g if b != a}

    # Segmentos de lateral: destino propio (sin vecinos), con nombre para el cliente
    en_mapa = set(boxes) | map_ids()
    nombre_lat = {sg['id']: f"{k.upper()} · {sg['nombre']}" for k, v in LAT.items() for sg in v}
    for a in nombre_lat:
        if a in neigh:
            for b in neigh[a]:
                neigh[b].discard(a)
            neigh[a] = set()
    pasillos = {a: {'m': 1 if a in en_mapa else 0, 'v': sorted(neigh.get(a, []))} for a in lst}
    for a, n in nombre_lat.items():
        if a in pasillos:
            pasillos[a]['n'] = n
            pasillos[a]['t'] = 'bloque' if a == '08r' else 'lateral'

    def rnd(d):
        return {k: round(v, 2) for k, v in d.items()}

    out = {
        'generado': {'skus': n_skus, 'tipos': len(tipos), 'conjuntos': len(conj_aisles),
                     'pasillos': len(lst), 'enMapa': len(boxes), 'tablaManual': bool(manual)},
        'pasillos': pasillos,
        'conjs': {k: {'e': conj_info.get(k, 'Otros'), 's': seg_id.get(k), 'n': names.get(k), 'a': rnd(v)}
                  for k, v in conj_aisles.items()},
        'tipos': {t: {k: rnd(v) for k, v in cs.items()} for t, cs in tipos.items()},
        'sinonimos': sin,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    miss = sum(1 for k in conj_aisles if k not in seg_id)
    if LAT:
        print('Laterales:', {k: round(v) for k, v in sorted(lat_n.items())}, '· sin segmento:', dict(lat_sin))
    print(f"OK {OUT.relative_to(ROOT)}: {out['generado']} · conjuntos sin segmento IA: {miss} · {OUT.stat().st_size // 1024} KB")


if __name__ == '__main__':
    sys.exit(main())
