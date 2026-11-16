// Interpreta lo que el cliente escribe o dicta como su pasillo actual («13B», «pasillo 13 b», «trece be»).
// Devuelve {id} con un id válido del plano, o {error:'vacio'|'desconocido'|'ambiguo', opciones?}.
const NUM = {
  cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20,
};
// El reconocimiento de voz escribe el nombre de la letra, no la letra.
const LETRA = { a: 'a', be: 'b', b: 'b', ce: 'c', se: 'c', c: 'c', de: 'd', d: 'd', e: 'e', efe: 'f', ge: 'g' };

export function normalizarPasillo(texto, ids) {
  const base = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(pasillo|gondola|estoy|en|el|la|numero|no|zona)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  if (!base) return { error: 'vacio' };
  const lista = ids.map(i => String(i).toLowerCase());
  const set = new Set(lista);
  const partes = base.split(' ').map(p => (p in NUM ? String(NUM[p]) : p in LETRA && !/^\d/.test(p) ? LETRA[p] : p));
  let plano = partes.join('');
  const m = plano.match(/^(\d{1,2})([a-z]?)$/);
  if (!m) return { error: 'desconocido' };
  const num = m[1].padStart(2, '0'), letra = m[2];
  if (letra) {
    const id = num + letra;
    return set.has(id) ? { id } : { error: 'desconocido' };
  }
  const candidatos = lista.filter(i => i.startsWith(num) && /^\d{2}[a-z]$/.test(i));
  if (candidatos.length === 1) return { id: candidatos[0] };
  if (set.has(num)) return { id: num };
  if (candidatos.length > 1) return { error: 'ambiguo', opciones: candidatos.map(c => c.toUpperCase()) };
  return { error: 'desconocido' };
}
