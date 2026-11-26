// Filtro de alcance previo al índice y al modelo: el piloto solo ayuda a ubicar productos de mejoramiento del hogar en la tienda.
// Reglas por patrón (sin IA, sin costo, siempre igual). Devuelve null si la consulta puede seguir, o {tipo, aviso:{t,s}} si no.
// Los patrones son estrechos a propósito: «matar hormigas», «ácido muriático», «pistola de silicona» o «caja de herramientas» son productos legítimos.
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const AVISOS = {
  basura: { t: 'No entendimos lo que escribiste', s: 'Escribe el producto o lo que necesitas, por ejemplo «tapete» o «pintar una pared».' },
  fuera: { t: 'No podemos ayudarte con eso', s: 'Aquí te ayudamos a encontrar productos de mejoramiento del hogar en la tienda.' },
  tienda: { t: 'Eso lo resuelven en la tienda', s: 'Pregunta en servicio al cliente o a un asesor; aquí buscamos productos.' }
};

// [tipo, aviso, patrón]: el primero que coincide gana. Se evalúa sobre texto sin tildes y en minúsculas.
// «[^.]» evita que una frase se junte con la siguiente (texto y respuestas previas se unen con «. »).
const REGLAS = [
  ['inyeccion', 'fuera', /\b(ignora|ignore|olvida|omite|desobedece)\b[^.]{0,30}\b(instrucciones|reglas|indicaciones|prompt|anteriores?|previous|instructions|rules)\b|\b(system prompt|prompt del sistema|tu prompt|tus instrucciones|tus reglas|eres ahora|a partir de ahora eres|actua como|act as|jailbreak|modo desarrollador|developer mode)\b|\brepite\b[^.]{0,20}\b(prompt|instrucciones)\b/],
  ['dano', 'fuera', /\b(matar|asesinar|herir|lastimar|envenenar|secuestrar|torturar|desaparecer|golpear|amordazar)\b[^.]{0,25}\b(gente|persona|personas|alguien|vecinos?|ninos?|mi (esposa|esposo|pareja|jefe|ex))\b|\btapar(le|les)?\b[^.]{0,10}\b(cara|boca)\b[^.]{0,25}\b(persona|personas|gente|alguien)\b/],
  ['ilegal', 'fuera', /\b(marihuana|mariguana|cannabis|cocaina|heroina|popper|poppers|extasis|estupefacientes?|drogas?|bazuco|metanfetamina|explosivos?|molotov|bomba casera|armas|arma de fuego|armas de fuego|municion|municiones|silenciador)\b/],
  ['fraude', 'fuera', /\b(robar|robarme|robarle|robarse|hurtar|hurto)\b|\b(sin pagar|no pagar|burlar|antihurto)\b/],
  ['tienda', 'tienda', /\b(servicio al cliente|salida de emergencia|parqueadero|parqueaderos|por donde salgo|donde (pago|puedo pagar)|como (puedo |debo )?pagar|cajas? (de )?autopago|mi carro)\b/]
];

function clasificar(texto) {
  const t = norm(texto).replace(/\s+/g, ' ').trim();
  const letras = (t.match(/\p{L}/gu) || []).length;
  // sin letras («???», «123») o una sola letra latina; un solo ideograma («画») puede ser una palabra y sigue su camino
  if (!letras || (letras < 2 && !/[^\u0000-ɏ]/.test(t))) return { tipo: 'basura', aviso: AVISOS.basura };
  // una «palabra» de más de 30 letras, o un trozo de 2 a 4 letras repetido 4 veces o más («aaaaa», «jajajaja»)
  if (/\p{L}{31,}/u.test(t) || /(\p{L}{1,4})\1{3,}/u.test(t.replace(/\s/g, ''))) return { tipo: 'basura', aviso: AVISOS.basura };
  for (const [tipo, aviso, re] of REGLAS) if (re.test(t)) return { tipo, aviso: AVISOS[aviso] };
  return null;
}

module.exports = { clasificar };
