# TinkerMatt

TinkerMatt es un modelador 3D web minimalista, inspirado en la rapidez de trabajo de Tinkercad pero diseñado desde el principio para que una persona y una IA puedan editar **el mismo modelo semántico**.

La idea no es construir un CAD industrial. Es cubrir muy bien un flujo de modelado práctico: primitivas, transformaciones, booleanas, alineación, grupos, STL, SVG extruido, texto, roscas y bevel/fillet, con una interfaz limpia y referencias semánticas opcionales.

## Estado actual — alpha 0.1

Ya están montadas las bases de la aplicación:

- viewport Three.js con grilla en milímetros;
- caja, cilindro y esfera;
- selección y selección múltiple;
- mover, rotar y escalar con gizmos;
- duplicar;
- copiar/pegar **sin desplazar la copia**;
- borrar;
- agrupar y desagrupar de forma no destructiva;
- sólido/hueco visual;
- unión, resta e intersección CSG para sólidos simples;
- alineación por centro en X/Y/Z;
- importación STL;
- importación SVG + extrusión;
- texto extruido;
- exportación STL;
- presets de material, incluido dorado metalizado;
- referencias semánticas opcionales y ocultas por defecto;
- grabación y repetición de acciones de duplicado/transformación;
- API semántica en `window.tinkerMatt` para que el futuro MCP controle el modelo directamente, sin simular clicks.

## Siguiente etapa

1. Generador de rosca paramétrico.
2. Bevel/chamfer y fillet, empezando por primitivas y luego por selección de aristas.
3. Referencias persistentes a caras/aristas/vértices/zonas, con nombres jerárquicos.
4. Guardado/carga del documento paramétrico.
5. MCP propio que opere sobre la misma API semántica del editor.
6. Test de aceptación: generar por lenguaje natural la planchuela en L con agujeros, texto `TINKERMATT`, tortuga SVG, redondeos y material dorado.

## Desarrollo

```bash
npm install
npm run dev
```

Build de producción:

```bash
npm run build
```

## Principios de UX

- La interfaz avanzada no debe estorbar al modelado normal.
- Los nombres y referencias son opcionales y permanecen ocultos hasta que se necesitan.
- Pegar conserva exactamente posición, rotación y escala.
- Las acciones repetitivas deben poder grabarse y repetirse.
- La IA modifica el modelo mediante operaciones semánticas, no mediante automatización del mouse.
