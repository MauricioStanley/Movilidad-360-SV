# Preview v36 — mejoras de producto y móvil

Fecha: 3 de octubre de 2026. Estado: **solo local**, sobre `codex/auditoria-preview`. No se realizó commit, push, PR, despliegue ni modificación de DNS. Se conservaron los cambios locales previos a esta etapa.

## Implementado

1. **Servicios ilustrados** en portada y cotizador. Siete imágenes propias, separadas y ligeras; agrupaciones «Viajar», «Enviar o trasladar» y «Una salida específica». Las fotos reales de vehículos y conductores no se reemplazaron. Catálogo común en `templates/services.json` para evitar divergencias entre ambas pantallas.
2. **Selección progresiva:** al elegir servicio se recoge el selector y se lleva el foco al dato que falta. Se puede volver a cambiar sin recorrer todo el catálogo. Se quitaron los rótulos numerados «Parada» de los servicios, no las paradas de un itinerario real.
3. **Aeropuerto en ambos sentidos:** ir al aeropuerto o recogida en aeropuerto con destino buscable o seleccionable en mapa. Origen, destino, mapa y enlaces de navegación mantienen el sentido correcto. No requiere GPS para una recogida en aeropuerto.
4. **Ahora / Programar:** fecha y hora de recogida en El Salvador, sin depender de la zona horaria del dispositivo. Rechaza fechas inexistentes, pasadas o incompletas. Maletas y vuelo opcionales, con validación. Se incluyen en el resumen de planificación y el mensaje de WhatsApp. No simula una reserva aceptada ni inventa anticipación mínima o disponibilidad.
5. **Rutas frecuentes voluntarias:** hasta seis rutas, con consentimiento, nombre, repetición, borrado y vencimiento a los 90 días. Solo puntos y servicio; no guarda importe, horario, teléfono, datos del pasajero ni cuenta bancaria. Recalcula al repetir, reinicia fecha/equipaje/pasajeros y no las presenta como viajes completados. La edición inmediata de una misma solicitud sí conserva los campos en memoria.
6. **Ruteo seguro al fallar el proveedor:** ya no se presenta la aproximación geométrica como tarifa calculada. Se ofrece «Precio por confirmar», reintento y revisión manual con puntos de recogida/destino. El motor conserva su fallback interno por compatibilidad, pero las pantallas de cotización no cobran esa distancia.
7. **Búsquedas más eficientes:** solicitudes idénticas simultáneas comparten llamada; búsquedas obsoletas en cola se cancelan y Enter repetido no encola llamadas mientras el botón está ocupado. Sigue siendo búsqueda explícita, no autocomplete remoto.
8. **Confirmación contextual:** aviso y cuentas bancarias solo en transferencia; propuesta de precio con estado accesible y foco; información frecuente y guardado en desplegables. Recargos, precio estimado y cancelación siguen visibles. Corregidos selección visual de aeropuerto recuperado y precio de encomienda durante carga.
9. **Móvil:** rejillas de dos columnas, imágenes completas, confirmación con cuerpo desplazable y pie accesible, campos de 16 px y barra inferior con espacio reservado. Se mantienen foco visible, movimiento reducido y estados anunciados.
10. **Mantenibilidad y contenido:** módulo puro de planificación, módulo de interfaz de solicitudes/favoritos, pruebas adicionales, ayuda y privacidad actualizadas, caché uniforme v36 y 12 páginas regeneradas con el generador existente. Sin dependencias nuevas de ejecución.

## Archivos centrales

- UI: `templates/home.html`, `templates/cotizar.html`, `templates/cotizar-modals.html`, `css/preview.css`.
- Catálogo y generación: `templates/services.json`, `scripts/build.cjs`.
- Dominio: `js/planner.js`; solicitud y favoritos: `js/request-options.js`.
- Integración y rutas: `js/app.js`, `js/geo.js`.
- Contenido: `templates/ayuda.html`, `templates/transporte-aeropuerto.html`, `js/data.js`, `privacy.html`.
- Imágenes: `img/services/*.webp`; prompts y procedencia en `img/services/README.md`.
- Pruebas nuevas: `tests/planner.test.cjs`, `tests/geo.test.cjs`, `tests/journey.test.cjs`, `tests/handoff.test.cjs`.

## Verificación realizada

| Comprobación | Resultado |
| --- | --- |
| `npm test` | 35/35 pruebas aprobadas; línea base al iniciar: 17 |
| `npm run check` | 12 páginas generadas sincronizadas, 14 HTML, 561 enlaces/recursos, sintaxis JS, IDs, metadatos y versiones de caché |
| `git diff --check` | Sin errores; advertencias de normalización LF/CRLF de Git en Windows |
| Recogida AILA → Centro Histórico | Ruta OSRM real observada: 39,9 km, unos 54 minutos sin tráfico en vivo, $31,21 estimados; no es un precio garantizado |
| Encomienda Centro Histórico → Multiplaza | Ruta real de 9,3 km; base $4 + express $5 + distancia; $13,18 estimados |
| Fecha faltante | Bloquea el paso a WhatsApp y enfoca el campo |
| Programación y mensaje | Prueba automatizada del mensaje con hora SV, vuelo, maletas, destinatario, banco y negociación; `window.open` simulado, no se enviaron mensajes |
| Favorito | Guardado voluntario, repetición/recalculo y reinicio de datos comprobados en navegador; se eliminó exclusivamente la ruta de prueba creada por el agente |
| Transferencia / efectivo | Cuentas y aviso aparecen/desaparecen; negociación lleva foco a la propuesta |
| Pantallas | Inspección desktop 1280 px y móvil emulado 375/320 px; confirmación en 320×568 sin desbordamiento horizontal y con acción inferior visible |
| Consola | Sin errores en los recorridos comprobados |
| Imágenes | 7 WebP de 480×480, 128.242 bytes en total, carga diferida y dimensiones reservadas |
| Previsualización Wi-Fi | Inicio y cotizador v36 e imagen devuelven HTTP 200 en `http://192.168.0.131:8777/` al terminar la revisión |

El detector de Impeccable se ejecutó una vez sobre las plantillas/estilos: modo degradado por falta de `htmlparser2`, `css-select`, `css-tree` y `domutils`. Devolvió cero entradas, pero **eso no prueba ausencia de problemas** ni sustituye las verificaciones funcionales. No se instalaron dependencias para forzar ese detector.

No se realizó prueba física de teléfono, lector de pantalla, GPS/PWA en teléfono, Lighthouse/CrUX, ni revisión exhaustiva de todos los destinos posibles. No se midió aumento de conversión. La búsqueda pública puede omitir lugares o devolver homónimos: se exige seleccionar y confirmar el punto; no se inventaron coordenadas para suplir esa limitación.

## Pendiente y razón

| Mejora | Qué falta / decisión necesaria |
| --- | --- |
| Backend y panel del operador | Elegir proveedor y presupuesto; responsables de aceptación/asignación; estados y reglas del negocio. No se construyó un panel que finja recibir solicitudes. |
| Estado real del viaje, disponibilidad y GPS compartido | Dependen del registro real de solicitudes, autenticación, autorización, consentimiento de ubicación y participación del conductor. |
| Búsqueda/ruteo preparados para mayor volumen | Elegir cuenta/proveedor o proxy con caché y cuota global. La limitación actual por navegador no controla el consumo agregado de toda la aplicación; OSRM/Nominatim públicos no ofrecen garantía de servicio para la operación. |
| Reglas de programados | Horarios, anticipación mínima, tiempos de espera, capacidad/equipaje y tratamiento de vuelos. Por ahora son solicitudes que el equipo debe aceptar, no promesas automáticas. |
| Reseñas automáticas | Integración oficial y permisos/coste según proveedor. Se preservaron las reseñas públicas verificadas en la etapa anterior, con fecha de consulta y actualización manual. |
| SEO/conversión con datos reales | Informes o invitación a Search Console/Analytics y volumen operativo. No hacen falta contraseñas. No se promete superar Uber/inDrive por estos cambios visuales. |

## Cómo revisar y continuar

- PC: `http://127.0.0.1:8777/`.
- Celular en la misma Wi-Fi: `http://192.168.0.131:8777/`. El PC/servidor deben continuar encendidos. La IP puede cambiar.
- En esta URL HTTP de red local, GPS/instalación PWA pueden estar restringidos por el navegador: usar búsqueda para probar. No se debilitó HTTPS ni la seguridad del navegador.
- Publicación pendiente de aprobación expresa del usuario. Antes de publicar, ejecutar `npm test` y `npm run check`, revisar configuración/caché y verificar el despliegue real.
