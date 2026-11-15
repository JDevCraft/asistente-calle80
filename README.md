# Asistente de necesidades – Calle 80

Búsqueda inteligente de productos: el cliente describe qué necesita (texto o voz), un modelo de IA (NVIDIA, con Gemini de respaldo) elige segmentos del catálogo y la página muestra productos reales con ruta guiada en el plano de la tienda.

## Estructura

```
api/
  sample.js      Función serverless: camino rápido por índice o prompt + IA (NVIDIA, respaldo Gemini)
  _engine.js     Reglas de destino: directo / preguntar / genérico
  _destinos.json Índice de destinos (generado, no editar a mano)
  _catalog.js    Catálogo completo de segmentos (el modelo recibe una versión recortada)
  _recorte.js    Recorta el catálogo a los segmentos parecidos a la pregunta (embeddings)
  _vectores.*    Vectores precalculados de los segmentos (generado por build_vectores.js)
scripts/
  build_destinos.py  Genera api/_destinos.json desde el Excel y el plano
  build_vectores.js  Genera api/_vectores.* (requiere NVIDIA_API_KEY)
test/
  engine.test.js     Pruebas del motor de destinos (npm test)
public/
  index.html     Página única (UI, SKUs, plano SVG, ranking y ruta)
  empleada-inicio.jpg   Imagen del inicio
data/
  Segmentacion_Productos_Calle80.xlsx   Fuente de datos del catálogo
vercel.json      Carpeta pública y duración de la función (60 s)
```

## Variables de entorno (Vercel)

| Variable | Uso |
|---|---|
| `NVIDIA_API_KEY` | Modelo principal y embeddings del recorte. Solo vive en el servidor. Admite varias claves separadas por coma. |
| `GEMINI_API_KEY` | Respaldo. Sin saltos de línea ni BOM. Admite varias claves separadas por coma. |
| `NVIDIA_MODEL` | Opcional. Fuerza un modelo de NVIDIA en lugar de la lista por defecto. |
| `GEMINI_MODEL` | Opcional. Modelo de Gemini a probar primero. |

Sin ninguna clave, la función responde solo con el índice cuando la consulta es un producto.

## Despliegue

```
npx vercel --prod
```

## Índice de destinos

```
python -X utf8 scripts/build_destinos.py
```

Correr cada vez que cambie el Excel o el plano. Si existe `data/pasillo_destino.json` (`{"destinos": {"id": ["19a","20a"]}}`), esa tabla manual define qué pasillos forman un destino.

## Flujo

1. Consulta de producto ("tapete", "tapete para baño"): `/api/sample` responde desde el índice, sin modelo, con `ruta.decision` y `ruta.destinos`.
2. Necesidad abierta ("impermeabilizar la pared"): el modelo de IA arma el plan; los destinos salen de los segmentos del grupo principal. Respuesta en caché por consulta normalizada.
3. La pantalla muestra el destino (o una opción por destino), traza una sola ruta e ilumina todos sus pasillos. Los productos quedan en "Ver ejemplos".

Flujo anterior:

navegador → `POST /api/sample` `{text, answers}` → Gemini → `plan` JSON → el navegador valida segmentos, puntúa SKUs (`pickSkus`) y pinta tarjetas + ruta.

## Laterales y bloque 08R

- Los laterales 01L–04L y la máquina de cables 08R están dibujados en el plano. Cada lateral se divide en segmentos (`02l-1`, `03l-4`, …), y cada segmento es un destino con su propia ruta.
- `data/laterales.json` define los segmentos. Un SKU con ubicación `02L23` (lateral 02L, módulo 23) va al segmento que tenga su **familia**. Si ninguno la tiene, va al segmento cuyo **rango de módulos** contiene el 23. Si tampoco hay, va al rango más cercano.
- Para cambiar un segmento, edita `data/laterales.json` y corre `python -X utf8 scripts/build_destinos.py`.
- El dibujo salió de `Mapa_tienda_Calle80_laterales.svg` y se aplicó con `scripts/patch_mapa_laterales.py <svg>`. El script es idempotente.

## Respuesta sobre el mapa (UX-07, sin ventana emergente)

La respuesta ya no abre el modal de características: todo se muestra en el mapa y en una línea de texto debajo (`#mapHint`).

- **Varias opciones** (p. ej. "tapetes", "sillas"): se pintan en azul las góndolas de cada opción y se pone una etiqueta tocable por opción (`#callouts`, botones `.callout`) con ícono y el nombre de la zona del plano (Muebles, Jardín…). Si dos opciones caen en la misma zona, la etiqueta agrega el uso (Sala, Baño) o el lugar. Debajo: "Selecciona la categoría de … que buscas".
- **Un destino**: igual que varias opciones, primero solo se marca el pasillo con su etiqueta, sin ruta. Debajo: dónde está, "Ahí podrás encontrar: …" y "Toca la etiqueta para ver cómo llegar".
- **Al tocar una etiqueta**: arranca el recorrido guiado y animado (`guided`: zoom a la entrada, la cámara sigue el trazo y vuelve al plano completo). Las demás opciones desaparecen (sin color, número ni etiqueta); para ver otra, se busca de nuevo. La etiqueta elegida sigue al mapa y se oculta mientras su pasillo está fuera de cuadro. Al terminar, la góndola destino queda en azul oscuro y "Tú estás aquí" marca el inicio.
- **Íconos de las etiquetas**: [Tabler Icons](https://tabler.io/icons) v3.19.0, estilo outline (solo trazo, grosor 1.6, monocromo), licencia MIT. Las claves de `ICON_SVG` conservan los nombres anteriores (p. ej. `couch` dibuja `sofa` de Tabler), embebidos en `ICON_SVG`. Se eligen por el nombre de la zona con la tabla `ICONOS`. Si dos opciones de la búsqueda caen en la misma zona (p. ej. tapetes: Decoración · Sala y Decoración · Baño), el ícono sale del uso con la tabla `USOS` (Sala → sillón, Baño → tina, Oficina → escritorio, Cocina → olla, Habitación → cama, Infantil → bebé, Navidad → pino…). El cálculo usa todas las opciones de la búsqueda, así que el ícono y el texto no cambian al elegir. Etiquetas compactas: 28 px de alto, letra de 12 px e ícono de 16 px. El texto pasa a dos líneas si es largo (`.callout .ct`, ancho máx. 120 px, corte en 60 caracteres). `layoutCallouts` pone cada etiqueta pegada a su pasillo, probando derecha, izquierda, arriba y abajo, y trata los pasillos marcados de todas las opciones como obstáculos; si ninguna posición está libre, la corre hacia abajo o hacia arriba. En pantallas de 380 px o menos la etiqueta es aún más compacta (24 px de alto, letra de 11 px). Si el mapa mide menos de 340 px de alto (teléfonos pequeños, p. ej. 320×568), la vista de opciones se acerca a los pasillos encontrados (`encuadre`); al tocar una etiqueta, la ruta usa la vista de siempre. Cada etiqueta trae un solo texto: la familia (nombre de la zona) o, si dos opciones comparten familia, solo la subcategoría; nunca ambas, ni pasillos ni ubicaciones (`subDe`): primero el uso (Sala, Baño); si el uso coincide, el grupo de productos que solo tiene esa opción, sin las palabras que comparte con las otras (sillas de aire libre: Madera / Ratan Pe). Si no hay nada que las distinga, la etiqueta queda solo con la categoría.
- Mensaje bajo el mapa: siempre "Selecciona la categoría de <producto> que buscas" (`pideCategoria`: tipo de producto del índice, o título del grupo principal de la IA, o el texto escrito). Antes de elegir va con ícono ⓘ en gris; con la ruta, con el ícono de IA en azul. Ya no se muestra "Tu producto está en… Ahí podrás encontrar…".
- Con resultados en el mapa, solo se ve el número de los pasillos donde hay producto (resaltados en azul); los números de los demás pasillos se ocultan (`#mapa.con-opciones`). Se mantienen las referencias Puntos de pago, Rampas eléctricas y P. EXH. En la primera carga (sin búsqueda) el plano va sin números de pasillo, solo con los nombres de zona. Los nombres de zona siguen el diseño de UX: Lato regular, gris #767676, unos 11,5 px en celular, horizontales salvo la fila superior (Organización, Decoración, Electrohogar, Baños & Cocinas, Plomería). Las posiciones están en `ZONA_UX` (clave: posición original del texto en el plano); `zonaDe` sigue usando la posición original para saber a qué zona pertenece cada góndola. "Puntos de pago" y "Rampas eléctricas" usan el mismo texto (clase `.ref`, sin la pastilla de fondo).
- Opciones en lugares sin mapa se mencionan en la línea de texto ("aún sin mapa; pregunta a un asesor").
- Código: `renderPlan`, `drawCallouts`, `layoutCallouts`, `zonaDe` y `drawStatic` en `public/index.html`; estilos en el bloque `/* UX-07 */`.

### Pasillos dibujados en varias piezas

Algunos pasillos están partidos en el plano por un paso de clientes, pero son un solo pasillo: 29A, 31A, 32A, 33A y 34A (pieza oeste `g-29a` + pieza este `g-29a-E`) y 05B, 06B, 07B, 09B, 11B, 12B y 14B (mitades `g-05b-N` y `g-05b-S`). Otras góndolas se unen con `data-parte` (19A, 16A–18A, 06A, 02A–04A, 40A–42A). `aisleEls(m)` reúne todas las piezas (`g-<m>`, `g-<m>-*`, `data-parte`) y sus números, así que el resaltado, el color del destino y la etiqueta cubren el pasillo de inicio a fin. La ruta sigue llegando a la cara del pasillo más cercana por donde camina el cliente.

### Patio Constructor (ubicaciones con prefijo P)

Las ubicaciones 01P, 02P… y "Zona P" están en Patio Constructor, fuera del plano. La app las guía hasta la salida del muro derecho (en pantalla) entre Plomería y Ferretería, justo arriba del lateral 04L · Ferretería: destino `patio` del plano, agregado con `python -X utf8 scripts/patch_patio.py` (idempotente; dibuja la salida `g-patio` con el mismo estilo y fila de los laterales 04L, gris como cualquier lateral, y su ancla en la grilla; el CSS la alumbra en amarillo solo cuando es destino de la búsqueda, con las clases `dest`/`dest-alt`). En la app (`esPatio`, `rutaAisle`, `mapIds`, `nombreCorto`): la etiqueta dice "Patio Constructor" en amarillo y, con la ruta, el mensaje bajo el mapa es "Dirígete a Patio Constructor" en tono amarillo. Si la opción también tiene pasillos dentro de la tienda (p. ej. varilla: 05C + 04P), la ruta va al pasillo de la tienda.

### Adhesivos y sellantes (zona de Pinturas)

Los adhesivos, sellantes, siliconas, masillas y el cemento de contacto están en la familia Pintura (pasillos 11B–14B), junto a los selladores tipo barniz o fondo. El motor (`api/_engine.js`, `lineaDe`) los separa en una línea propia antes de agrupar pasillos:

- **Adhesivos y sellantes** (`linea: 'adh'`): grupos de Pintura cuyo nombre dice adhesivo, sellador/sellante, silicona, neutra, masilla, colas frías, pega, epóxico, hotmelt, neopreno, contacto o espuma (`RE_ADH`).
- **Pinturas**: el resto, incluidos los selladores tipo barniz o fondo (fondos nitro, catalizados, fijadores, barnices, lacas, vitrificantes, hidrorrepelentes, esmaltes, pinturas industriales: `RE_ACABADO`).

Cada línea es una opción aparte aunque compartan pasillo. La app (`esAdhesivo` en `public/index.html`) titula la opción `adh` "Adhesivos y sellantes" con ícono de frasco (`bottle`). Ejemplos: "sellador" → Pinturas / Adhesivos y sellantes; "cemento" → Patio Constructor / Adhesivos y sellantes; "pintura" → Pinturas.

Al tocar una opción, la ruta pinta el pasillo completo aunque llegue a una de sus mitades (`styleRoute`: 11b-n → 11b).

### Respaldo cuando la IA no responde

Las búsquedas que el índice no entiende completas (p. ej. "jarra de jugo": el índice conoce "jarra" pero ninguna categoría dice "jugo") van a Gemini (`api/sample.js`). Si Gemini no está disponible (sin `GEMINI_API_KEY`, cuota agotada 429, modelo saturado 503, tiempo agotado o JSON inválido), la función ya no devuelve error: responde con el índice ignorando las palabras que no entiende (`rapido(text, { laxo: true })` en `api/_engine.js`) y marca la ruta con `respaldo: true`. Si tampoco hay una palabra de producto en la consulta, devuelve el error como antes. En los logs de Vercel queda la línea `respaldo indice <motivo>`.

### Nombre de la etiqueta y prueba en teléfonos

- **Nombre**: la etiqueta usa la familia del catálogo con más SKUs del destino (`familia` en cada destino, `FAM_CORTO` en `api/_engine.js`: Iluminación, Hogar & Menaje, Pinturas…). El nombre de la zona del plano más cercana (`zonaDe`) queda solo como respaldo, porque en zonas con varios nombres se equivocaba (bombillo salía "Aseo", jarra salía "Decoración").
- **Acomodo**: si ninguna posición junto al pasillo está libre, `layoutCallouts` evalúa más posiciones alrededor y elige la que menos tape (montarse sobre otra etiqueta cuenta el triple que tapar un pasillo).
- **Prueba de usabilidad (2026-11-12)**: 10 resoluciones de teléfono (320×568, 360×640, 360×740, 360×800, 375×667, 375×812, 390×844, 412×915, 414×896, 430×932) × 14 búsquedas, con iframes del mismo origen. Se mide: etiquetas encima de pasillos marcados, etiquetas montadas entre sí, etiquetas fuera del mapa, texto cortado, mensaje y caja de búsqueda visibles sin desplazarse, desplazamiento horizontal, y que al tocar una etiqueta salga la ruta. Resultado final: 140/140 sin problemas de acomodo.

### Manejo de errores cuando la IA no responde

- **Servidor** (`api/sample.js`): si todos los modelos de Gemini fallan por cuota (429), saturación (503) o tiempo agotado, espera 2 s y hace una segunda ronda (si quedan 15 s o más del plazo). Si sigue sin responder, usa el respaldo del índice (`respaldo: true`, `motivo`) o devuelve `503 {"error":"ia_ocupada"}`.
- **App** (`ask` y `sampleFn` en `public/index.html`):
  - Reintenta sola una vez a los 1,5 s solo si se cortó la conexión (`network`); con errores del proveedor no reintenta, porque el servidor ya probó varios modelos y claves. Mientras tanto muestra "Reconectando con el asistente…".
  - Si vuelve a fallar, muestra un mensaje según el caso (`ERR`: `ia_ocupada`, `error`, `network`, `timeout`) que sugiere escribir solo el producto, con un botón **Reintentar** (`setError`).
  - Si respondió el índice porque la IA no pudo, avisa: "El asistente no pudo armar recomendaciones ahora; te mostramos dónde está «…»".
  - "Detener" cancela también la espera del reintento.

### Modelo de IA: NVIDIA (principal) y Gemini (respaldo)

- **Principal**: NVIDIA, API compatible con OpenAI (`https://integrate.api.nvidia.com/v1/chat/completions`), sin razonamiento (`chat_template_kwargs.thinking=false`). Modelos y límites por intento en `NV_MODELOS` (ver la sección del catálogo recortado). Clave en `NVIDIA_API_KEY` de Vercel (Production y Preview); `NVIDIA_MODEL` fuerza un modelo.
- **Respaldo**: si NVIDIA falla, supera el límite de tiempo o devuelve JSON inválido, se usa Gemini (`GEMINI_API_KEY`) con sus dos rondas, si queda tiempo; si tampoco, el índice (`respaldo: true`).
- **Varias claves**: `NVIDIA_API_KEY` y `GEMINI_API_KEY` aceptan varias claves separadas por coma (`nvapi-a,nvapi-b`), y además se leen `NVIDIA_API_KEY_2` … `_9` y `GEMINI_API_KEY_2` … `_9` (una clave extra por variable). Se usa la principal y luego las numeradas en orden; si responde 429 (cuota agotada) o 401/403 (inválida), se prueba la siguiente con el mismo modelo. Las inválidas no se reintentan en esa petición. Los embeddings del recorte rotan igual. `scripts/build_vectores.js` usa solo la primera.
- **Prueba de modelos (2026-11-12)**, mismo prompt del asistente (~28 mil tokens por el catálogo): minimax-m3.1-flash 17–23 s con JSON válido; nemotron-3-ultra-550b 32 s; nemotron-3.5-lightning 38 s con JSON inválido; deepseek-v4.1-flash, glm-5.3-flash, gpt-oss-20b y mistral-large-4 pasaron de 40–45 s. Muchos modelos de la lista no están habilitados para la cuenta (404). Gemini, cuando tiene cuota, responde en 2–3 s.

### Catálogo recortado por pregunta (menos tokens, más rápido)

En vez de mandarle al modelo los ~2.540 segmentos del catálogo (~28 mil tokens) en cada pregunta, se le mandan solo los relevantes (~2–3 mil tokens). El catálogo completo no se pierde: sigue en `api/_catalog.js` y se usa entero si el recorte falla.

- **Una sola vez**: `NVIDIA_API_KEY=nvapi-... node scripts/build_vectores.js` convierte cada segmento en un vector con `nvidia/nemotron-3.5-embed-1b` y los guarda en `api/_vectores.bin` (int8, 5 MB) y `api/_vectores.json`. Volver a correrlo cada vez que cambie el catálogo (después de `scripts/build_destinos.py`). Tarda ~1 minuto. `vercel.json` incluye esos archivos en la función (`includeFiles`).
- **En cada pregunta** (`api/_recorte.js`, `catalogoPara`): convierte la pregunta en vector (~0,1–0,4 s), toma los 150 segmentos más parecidos, suma hasta 40 cuyo nombre contiene una palabra de la pregunta y nombra las familias que no quedaron. La respuesta de la API trae `catalogo: { segmentos, ms }` o `"completo"`.
- **Respuesta más corta**: el prompt pide 2 a 4 grupos, máximo 4 segmentos por grupo y frases cortas (`max_tokens` 2048).
- **Modelos** (`NV_MODELOS` en `api/sample.js`): `nvidia/nemotron-3.5-bolt-e4b` (15 s de límite) y, si falla, `nvidia/nemotron-3-ultra-550b-a55b` (25 s); luego Gemini y luego el índice. Prueba con 6 preguntas y catálogo recortado: bolt-e4b 6/6 en 5,2 s promedio; ultra 6/6 en 10,9 s; minimax-m3.1-flash 5/6 en 12,8 s; lightning-30b 4/6.
- **Resultado en producción**: preguntas abiertas en 5–6 s (antes 17–33 s con el catálogo completo), con ~91 % menos tokens.
