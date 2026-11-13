# Cómo está montado el mapa de la tienda (Calle 80)

El mapa es un **SVG hecho a mano con JavaScript puro**. No usa ninguna librería de mapas (ni Leaflet, ni Mapbox, ni D3) y la página no carga scripts externos (`<script src>`).

## Piezas

| Pieza | Qué es | Dónde |
|---|---|---|
| Contenedor | Elemento `<svg id="mapa">` vacío que se llena al cargar la página | `public/index.html:456` |
| Datos del plano | Módulo inline con un objeto de configuración: `viewBox`, entrada, leyenda y el árbol SVG de pasillos y muebles. También trae los `hitos`, que son los puntos de referencia que se usan en las indicaciones de la ruta | `public/index.html:471` |
| Render | El navegador crea los elementos con `document.createElementNS(...)`: el trazo de la ruta (`path`) y el marcador animado (`circle` + `animate`) | `public/index.html:659-671` |
| Estilo | CSS limitado a `#mapa` dentro del mismo `index.html`: capas ocultas (familias y módulos) y resaltado en azul de los pasillos del destino | `public/index.html` |
| Rutas | Se calculan en el cliente sobre los 70 pasillos recorribles que devuelve `pasillosDelPlano` | `public/index.html` |

## Consecuencias prácticas

- Para agregar o mover un pasillo hay que editar el árbol SVG embebido en el módulo del plano. No hay un archivo de mapa aparte.
- Las ubicaciones que no están en ese árbol (zonas D, P, L, E, R y algunos pasillos) no se pueden dibujar ni recorrer en el mapa.
- Como todo se dibuja en el navegador, el mapa solo existe en el DOM ya renderizado. Para exportarlo (por ejemplo a PDF) hay que capturarlo de la página cargada.
