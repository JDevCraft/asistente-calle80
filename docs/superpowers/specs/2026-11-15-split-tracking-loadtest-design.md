# Diseño: separar frontend/backend, tracking de beta, prueba de carga

## Intención y por qué

El asistente va a abrir un beta test con tráfico real (cientos a miles de
sesiones/día). Se confirmó que no hay tablets ni terminales fijos de la
tienda: todo el tráfico es de clientes usando su propio celular, dentro o
fuera de la tienda — no existe el escenario de dispositivo compartido entre
varios clientes. Para eso hacen falta tres cosas que hoy no existen: (1) poder
desplegar frontend y backend por separado, con la posibilidad de mover el
backend a otra infraestructura más adelante sin reescribir el frontend, (2)
captar datos de comportamiento (heatmaps/replay) y de demanda real
(qué buscan los clientes y qué les respondió el asistente) para que el beta
produzca información útil, no solo validación técnica, y (3) saber cómo se
comporta el camino lento del sistema (NVIDIA → Gemini → índice) bajo varias
búsquedas simultáneas antes de que lo golpee tráfico real.

Se investigó primero si el soporte actual de Vercel bastaba para el backend
en producción o si había que pasar a un servidor dedicado. Con datos de la
documentación de Vercel (context7, `/websites/vercel`): el plan Hobby ya
escala automáticamente hasta 30.000 ejecuciones concurrentes (ráfaga de 1.000
cada 10s por región) y factura "Active CPU" — el tiempo esperando respuesta
de NVIDIA/Gemini (5-45s) no se cobra como CPU, solo como memoria provisionada.
A la escala declarada (cientos-miles de sesiones/día ≈ decenas de miles de
invocaciones/mes) esto está muy por debajo de los límites, y el patrón de
carga de esta app (I/O-bound esperando LLM) es justo el que esa facturación
trata mejor. Conclusión: no hay hoy una razón numérica para un servidor
dedicado. El usuario confirmó quedarse en Vercel, dejando la opcionalidad de
migrar el backend después.

## Objetivos

- Separar frontend (`public/`) y backend (`api/`) en dos proyectos Vercel
  conectados por un rewrite, de forma que el backend pueda migrarse a otra
  infraestructura después cambiando solo el destino del rewrite.
- Reemplazar el caché y el rate-limiter en memoria de `api/sample.js` (que no
  sobreviven al auto-escalado a múltiples instancias) por un rate limiter
  gestionado y un caché compartido.
- Añadir Microsoft Clarity (heatmaps + session replay) en la página pública;
  al ser siempre el celular propio del cliente, cada sesión de Clarity
  corresponde a una sola persona sin necesidad de lógica de reseteo por
  dispositivo compartido.
- Añadir captura estructurada de cada búsqueda (texto normalizado, destino/
  segmento resuelto, si cayó en `respaldo`/error, tiempo de respuesta) desde
  `api/sample.js`, escrita a un almacén consultable por el equipo de
  producto.
- Ejecutar una prueba de carga sintética (k6 o Artillery) contra un deploy de
  preview antes de abrir el beta, enfocada en el camino lento con IA bajo
  varias búsquedas simultáneas.
- Sumar fuentes de datos complementarias (Google Analytics 4, captura de
  errores de cliente, y campos adicionales en el log estructurado) para que
  el beta deje información útil más allá de lo que da Vercel Web Analytics
  en plan Hobby — ver "Fuentes de datos complementarias".
- Mostrar un aviso de tratamiento de datos (Ley 1581) antes de que el
  tracking capte nada de valor para el negocio, y centralizar los datos
  cuantitativos (búsquedas, encuesta, GA4) en un solo panel consultable —
  ver "Banner de tratamiento de datos" y "Centralización de datos".

## No-objetivos

- No se migra el backend a un servidor/contenedor propio en este trabajo —
  solo se deja la puerta abierta para hacerlo después.
- No se construye un dashboard de producto a medida para los datos de
  búsqueda; el entregable es la captura y exportación de los datos, no su
  visualización final.
- No se rediseña el contrato de códigos de error entre cliente y servidor
  (ya documentado como deuda en CLAUDE.md); se toca solo lo necesario para
  que el nuevo rate limiter devuelva un código compatible con el `ERR` map
  existente en `index.html`.

## Anti-objetivos (qué lo haría un fracaso aunque "funcione")

- Que el rate limiter o el caché compartido rompan el camino rápido
  (`rapido()`, sin IA) que hoy responde sin tocar NVIDIA/Gemini — ese camino
  debe seguir siendo igual de barato y rápido.
- Que la separación en dos proyectos Vercel rompa el CSP/headers de
  seguridad ya configurados en `vercel.json`, o abra CORS más permisivo del
  necesario entre frontend y backend.

## Restricciones

- Sin npm dependencies hoy (`package.json` no tiene `dependencies`); cualquier
  SDK nuevo (`@vercel/firewall`, `@vercel/analytics`, cliente de Redis) es la
  primera dependencia real del proyecto — evaluar si se instala como
  dependencia de `api/` únicamente o de todo el repo.
- `vercel.json` ya define `maxDuration: 60` y cabeceras de seguridad globales
  — deben preservarse al dividir en dos proyectos.
- Las claves `NVIDIA_API_KEY`/`GEMINI_API_KEY` son server-only hoy; al separar
  proyectos deben seguir viviendo solo en el proyecto backend, nunca en el
  frontend.
- Ley 1581 (Colombia, habeas data): Clarity, GA4, el log estructurado y la
  encuesta captan datos de navegación/comportamiento; requieren aviso de
  tratamiento de datos visible. El usuario decidió el modelo "aviso con
  opción de rechazar" (no bloqueante) — ver "Banner de tratamiento de
  datos". El texto legal exacto del aviso debe revisarlo el negocio (o un
  abogado), no es algo que este diseño pueda cerrar por su cuenta.

## Enfoques considerados

**Separación frontend/backend**
- *Un solo proyecto Vercel, sin separar* — descartado: no da ciclos de
  despliegue independientes ni la opcionalidad de migrar el backend que pidió
  el usuario como motivo explícito del split.
- *Dos proyectos Vercel + rewrite* (elegido) — el navegador sigue viendo un
  dominio único; el backend puede migrar después cambiando solo el
  `destination` del rewrite, sin tocar el frontend ni el dominio público. Es
  el patrón documentado por Vercel para este caso ("Combine multiple
  services" / "Proxy API requests").
- *Separar ya a un servidor dedicado* — descartado por el usuario: sin
  justificación numérica a esta escala, y pierde la facturación favorable de
  Active CPU para el patrón I/O-bound de este asistente.

**Rate limiting y caché compartido**
- *Seguir con los `Map` en memoria* — descartado: ya se identificó que no
  sobrevive al auto-escalado (cada instancia tiene su propia memoria).
- *Montar Redis propio en un servidor* — descartado: innecesario, ya que el
  backend se queda en Vercel.
- *`@vercel/firewall` (`checkRateLimit`) como mecanismo del límite de
  negocio (20 req/10min)* — descartado al escribir el plan: depende de una
  regla configurada en el dashboard y de variables de entorno que solo
  existen en un deployment real; no hay forma documentada de probarlo
  offline con `node --test`, y el test que hoy fija ese límite
  (`test/sample.test.js`) quedaría imposible de mantener como parte de
  `npm test`.
- *Upstash Redis para el límite de negocio (20 req/10min) y el caché, los
  dos en el mismo almacén* (elegido) — mismo cliente, mockeable en tests
  igual que ya se mockea `global.fetch`, sin depender de configuración fuera
  del código. `@vercel/firewall` se mantiene como capa adicional de borde
  (protección genérica contra abuso), configurada solo en el dashboard de
  Vercel, sin que el código ni los tests dependan de ella.

**Tracking**
- *Solo Clarity* — descartado: Clarity no estructura qué buscó cada cliente
  ni qué le respondió el asistente; el usuario confirmó que necesita ambas
  cosas.
- *Solo logging estructurado propio* — descartado: no da heatmaps/replay de
  cómo la gente usa el mapa y la UI, que es justo el objetivo de UX del beta.
- *Clarity (heatmaps/replay) + logging estructurado server-side en
  `api/sample.js` exportado vía Log Drains* — descartado tras la revisión del
  constructor: los Log Drains con endpoint custom requieren plan Pro o
  Enterprise; Hobby no los soporta. Forzar un upgrade de plan solo por esto
  reabriría el análisis de costo que justificó quedarse en Vercel.
- *Clarity (heatmaps/replay) + logging estructurado server-side en
  `api/sample.js`, escrito directo al mismo almacén compartido (Upstash
  Redis, o una tabla Postgres vía Marketplace) que ya se añade para el
  caché* (elegido) — cubre ambas necesidades sin depender de Log Drains ni
  de subir a plan Pro; el equipo de producto consulta ese almacén
  directamente o vía un export periódico, en vez de un log drain en vivo.

**Validar el camino lento antes del beta**
- *Confiar solo en tráfico orgánico del beta* — descartado por el usuario:
  no detecta el problema hasta que ya está en producción con usuarios reales.
- *Prueba de carga sintética (k6/Artillery) contra un deploy de preview,
  simulando varias búsquedas simultáneas por el camino con IA* (elegido) —
  valida el punto más frágil (latencia de NVIDIA/Gemini bajo concurrencia, y
  el comportamiento del nuevo rate limiter/caché) con datos controlados antes
  de exponerlo a usuarios reales.

## Banner de tratamiento de datos

- *Opt-in bloqueante* (nada de tracking arranca hasta aceptar) — descartado
  por el usuario: en un beta reduce el volumen de datos captados, que es
  justo lo que se busca maximizar.
- *Aviso con opción de rechazar (notice + opt-out)* (elegido) — Clarity, GA4
  y el log estructurado arrancan por defecto desde que carga la página; un
  banner no bloqueante informa qué se capta y da un botón para desactivarlo.
  Maximiza los datos del beta. El texto legal exacto para Colombia queda
  pendiente de revisión por el negocio (ver Restricciones).
- El banner se muestra una vez por dispositivo (flag en `localStorage`); si
  la persona lo cierra sin tocar "desactivar", se asume aceptado (consistente
  con el modelo opt-out elegido). El estado de "desactivado" debe apagar
  Clarity, GA4 y el envío del log estructurado por igual — no solo uno de
  los tres.

## Centralización de datos

Ya estaba decidido no construir un dashboard de producto a medida
(No-objetivos). Centralizar sin violar eso:

- *Llevar todo (incluido Clarity y Sentry) a un solo almacén propio* —
  descartado: Clarity (replay/heatmaps) y Sentry (trazas de error) son
  herramientas de "ver el detalle", no datos tabulares que tenga sentido
  aplanar a filas; forzar eso es construir infraestructura nueva por un
  beneficio marginal.
- *Postgres (log estructurado + encuesta) + BigQuery (export gratis de GA4)
  + Looker Studio conectado a ambos, gratis* (elegido) — centraliza los
  datos cuantitativos en un panel sin "construir" nada (Looker Studio es una
  herramienta ya hecha, no código propio). Clarity y Sentry se quedan en sus
  propias consolas, documentadas en el mismo sitio (el README del proyecto o
  este diseño) para que el equipo sepa dónde mirar cada cosa.
- La respuesta de la micro-encuesta ("¿te ayudó?") se guarda como campo del
  mismo registro de búsqueda en Postgres (no en un sitio aparte), para que
  quede ligada a qué buscó la persona y qué le respondió el asistente.

## Fuentes de datos complementarias

Vercel Web Analytics en Hobby está muy limitado para sacarle valor al beta:
50.000 eventos/mes, ventana de reporte de **1 mes**, y **sin eventos
personalizados** (los custom events solo existen desde Pro). Speed Insights
gratis en Hobby solo da el score agregado (RES) en ventanas de 24h/7 días,
sin desglose completo de Core Web Vitals (eso pide Speed Insights Plus,
Pro+). Para que el beta deje información útil más allá de esa ventana corta,
se suman estas fuentes, cada una con un rol distinto — ninguna sustituye el
log estructurado ya decidido, que sigue siendo la fuente de verdad para
demanda de catálogo:

- **Google Analytics 4** (gratis, sin depender del plan de Vercel): eventos
  personalizados ilimitados, reportes agregados estándar que no caducan por
  la retención configurada (solo Explorations/funnels quedan sujetos a 2 o
  14 meses), y exportación gratis a BigQuery (sandbox) para histórico crudo
  sin límite de tiempo. Rol: comportamiento/marketing — de dónde llegan los
  visitantes, dispositivo, embudo de navegación — no sustituye el log de
  búsquedas.
- **Core Web Vitals vía GA4**: enviar las métricas de la librería
  `web-vitals` como evento custom de GA4, para tener más historia de
  rendimiento que la ventana corta de Speed Insights en Hobby, sin pagar
  Speed Insights Plus.
- **Captura de errores de cliente** (ej. Sentry, plan free): hoy no hay
  visibilidad de errores JS reales en dispositivos de usuarios reales; en un
  beta con celulares variados (ya se probaron 10 resoluciones distintas en
  la usabilidad del mapa) esto expone fallos que no aparecen en desarrollo.
- **Proveedor que respondió cada búsqueda** (índice directo / NVIDIA /
  Gemini / respaldo laxo / error) como campo adicional del log estructurado
  ya decidido — dato que ya existe en `api/sample.js`, sin costo agregarlo,
  y que mide calidad de respuesta y cuánto se cae a Gemini/respaldo.
- **Uso de voz vs texto**: porcentaje de búsquedas por dictado y su tasa de
  reintento, como campo del mismo log estructurado — dato de producto que
  ningún tercero provee.
- **Embudo propio de conversión** (buscó → vio opciones → tocó etiqueta →
  llegó a la ruta) como parte del log estructurado o de eventos de GA4 — más
  preciso que un heatmap para saber si la gente realmente encuentra el
  producto.
- **Micro-encuesta de una pregunta** ("¿esto te ayudó?") tras mostrar la
  ruta — señal cualitativa barata que ni Clarity ni GA4 dan por sí solos.

## Decisiones ya tomadas

- Backend se queda en Vercel; la separación se diseña con reversibilidad
  (rewrite), no como paso intermedio hacia una migración ya decidida.
- Se incluye prueba de carga sintética antes de abrir el beta a usuarios
  reales.
- El límite de negocio (20 req/10min por IP) y el caché comparten el mismo
  almacén: Upstash Redis vía Marketplace de Vercel (disponible en Hobby).
  `@vercel/firewall` (1 regla de rate limiting incluida en las 3 reglas
  gratis de firewall del plan Hobby) se configura además, solo en el
  dashboard, como protección genérica de borde — el código y los tests no
  dependen de él.
- Tracking: Clarity + logging estructurado de búsquedas, ambos — no uno
  sustituyendo al otro. El logging estructurado escribe directo al almacén
  compartido (no Log Drains — ver "Enfoques considerados"), para no
  depender de plan Pro.
- Entre los dos proyectos Vercel (frontend/backend), configurar explícitamente
  **Trusted Sources / Protection Bypass for Automation** en Deployment
  Protection. Sin esto, el rewrite del frontend hacia el backend en entornos
  Preview —y la prueba de carga corriendo contra ese mismo Preview— puede
  chocar con el reto de autenticación de Vercel en vez de llegar al handler
  real: el síntoma es que todo "funciona" (respuestas rápidas, pocos
  errores) pero en realidad está midiendo la página de reto, no el camino
  NVIDIA→Gemini→índice. Es un paso obligatorio de la configuración, no
  opcional.
- Se suman Google Analytics 4 y captura de errores de cliente como fuentes
  complementarias al log estructurado y Clarity, dado que Vercel Web
  Analytics en Hobby no soporta eventos personalizados ni retención más allá
  de 1 mes — ver "Fuentes de datos complementarias".
- Banner de tratamiento de datos en modelo "aviso con opción de rechazar"
  (no bloqueante); apaga Clarity, GA4 y el log estructurado por igual si la
  persona lo rechaza. Texto legal pendiente de revisión por el negocio.
- Centralización: Postgres (log estructurado + respuesta de la encuesta) +
  BigQuery (export de GA4) + Looker Studio como panel único, sin construir
  dashboard propio. Clarity y Sentry quedan en sus propias consolas.
- Seguimiento de la implementación (son muchos frentes, varias sesiones
  probables): mantener
  `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-EXECUTION.md`
  como log de ejecución, actualizado por frente completado, además del plan
  paso a paso que genere `superpowers:writing-plans`.

## Lo que queda a criterio de quien lo construya

- Estructura exacta de los dos proyectos Vercel (monorepo con dos
  `vercel.json`/directorios de despliegue vs. dos repos separados) — mientras
  se preserven las cabeceras de seguridad y el aislamiento de env vars.
- Esquema exacto de los campos a loguear por búsqueda en el almacén
  compartido (Upstash Redis / Postgres vía Marketplace) y cómo lo consulta el
  equipo de producto (acceso directo vs. export periódico) — mientras
  capture texto normalizado, resultado (directo/IA/respaldo/error), proveedor
  que respondió, canal (voz/texto) y tiempo de respuesta.
- Herramienta exacta de prueba de carga (k6 vs Artillery) y los escenarios
  concretos de concurrencia a simular.
- Herramienta exacta de captura de errores de cliente (Sentry u otra) y su
  plan/cuota.
- Taxonomía exacta de eventos GA4 (nombres y parámetros) y si se envían
  server-side (Measurement Protocol desde `api/sample.js`) o solo
  client-side.
- Mecanismo exacto de la micro-encuesta (modal, toast, dónde y cuándo se
  muestra) — la respuesta ya se decidió que va a Postgres junto al registro
  de esa búsqueda, eso no queda abierto.
- Texto legal exacto del banner de tratamiento de datos — requiere revisión
  del negocio o un abogado antes de publicarse, no es algo que se pueda
  cerrar solo con criterio técnico.
- Diseño exacto del reporte en Looker Studio (qué tablas/vistas, qué
  gráficas) — mientras combine los datos de Postgres y BigQuery sin
  requerir código nuevo.
