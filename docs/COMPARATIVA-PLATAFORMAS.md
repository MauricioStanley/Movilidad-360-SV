# Movilidad 360 SV: revisión local y comparación de producto

Fecha de consulta: 3 de octubre de 2026. Versión local: 35, rama `codex/auditoria-preview`. No publicada.

Evaluación dual independiente: A (Leibniz, `01a10326-8b6d-7e70-b0b9-4b00013bf17e`) revisó estructura y UX; B (Kant, `01a1032c-3e93-75d0-bf8f-eb1fb6289654`) revisó implementación, validaciones y escritorio. La revisión principal contrastó sus resultados y comprobó navegador a 1280 px y 375 px. No se solicitaron viajes, enviaron mensajes ni realizaron pagos.

## Conclusión

La brecha principal no es visual. Movilidad 360 SV cotiza y prepara una solicitud para coordinación humana por WhatsApp. Uber e inDrive documentan flujos que conectan solicitud, aceptación, conductor, trayecto e historial. Una interfaz no puede sustituir la disponibilidad real ni la operación necesaria para cumplir ese ciclo.

No hay evidencia para afirmar que Movilidad cobre más, tenga peor atención, convierta menos o sea menos segura: faltan datos operativos y analíticos comparables. Esta comparación identifica capacidades, no resultados comerciales medidos.

La especialización recomendada es transporte programado, aeropuerto, familias y turismo con atención humana. No copiar asignación automática ni selección libre de vehículos: el negocio actual establece que el operador decide qué vehículo enviar.

## Base que conviene conservar

- Cotización por carretera con distinción entre ruta calculada y aproximación, desglose y negociación.
- Origen y destino elegibles, solicitud para otra persona, mascotas, pasajeros, efectivo/transferencia y enlaces Waze.
- PWA, borrador local, servicios separados, flota real y preguntas frecuentes: ya existen; no deben venderse como funcionalidades faltantes.
- Mensaje explícito de que enviar a WhatsApp no confirma una reserva. Controles de diálogo, teclado y recuperación que ya funcionan.
- Identidad oscura con acentos verde manzana. La mejora necesaria es jerarquía y claridad, no otra sustitución estética.

## Qué se activó

`TESTIMONIALS` estaba vacío; no había testimonios reales ocultos listos para publicar. Se consultó el perfil público de Google y se añadieron tres extractos breves atribuidos a Roberto Zacarias, Aleja Dominguez y Violeta Dominguez. La consulta mostraba 5,0/5 y ocho opiniones.

`js/data.js`, `js/app.js`, `templates/home.html` y `css/preview.css` ahora muestran selección, fuente, fecha de consulta y aviso de actualización manual. Los botones para leer y dejar una reseña tienen enlaces estáticos válidos. No se reactivó el contador de viajes sin confirmar ni se inventaron testimonios. La calificación no se actualiza automáticamente y no se prometen estrellas en resultados de Google.

Fuente del perfil: https://g.page/r/CRSjuTnHg7ohECE

## Comparación documentada

| Capacidad | Movilidad hoy | Referentes y diferencia |
|---|---|---|
| Solicitud | Se prepara y abre WhatsApp; la web no conoce el resultado | Uber conecta solicitud con conductor; inDrive permite ofertas, aceptación y elección dentro de su producto |
| Negociación | Propuesta para que una persona la evalúe | inDrive documenta contrapropuestas y aceptación de conductores |
| Tiempo | Estimación de trayecto | Tiempo del trayecto no equivale a llegada de un conductor disponible |
| Seguimiento | Waze facilita navegación | No es seguimiento compartido del vehículo; inDrive documenta seguimiento del viaje en tiempo real |
| Programación | No hay fecha y hora estructuradas para el viaje de pasajeros | La página de Uber para SAL presenta viajes programados |
| Después de solicitar | Borrador y conversación externa | Historial, soporte y estado del viaje integrados en las plataformas |

Fuentes oficiales consultadas: [Uber SV](https://www.uber.com/sv/es/ride/), [Uber aeropuerto SAL](https://www.uber.com/global/es-es/r/airports/sal/taxi/), [inDrive viajes urbanos](https://indrive.com/city-rides), [inDrive seguridad del pasajero](https://indrive.com/safety/passengers). Son capacidades documentadas; no se validó su disponibilidad en cada municipio ni se recorrieron cuentas autenticadas de los competidores.

## Evaluación heurística de UX

Puntuación provisional de criterio experto, no métrica de conversión ni comparación numérica con competidores.

| Heurística | Puntuación /4 | Motivo principal |
|---|---:|---|
| Estado del sistema | 3 | Distingue carga y solicitud, pero no dispone de estado operativo |
| Correspondencia con la realidad | 2 | Guía de recogida en aeropuerto conduce a un flujo cuyo destino es el aeropuerto |
| Control del usuario | 3 | Edición, cierre y borrador; falta repetir solicitudes con menos pasos |
| Consistencia | 3 | Componentes coherentes, pero «paradas» parecen pasos secuenciales |
| Prevención de errores | 3 | Validaciones útiles; ruta no confirmada todavía puede parecer cotizable |
| Reconocimiento | 3 | Opciones visibles; demasiadas compiten al inicio |
| Eficiencia | 2 | Sin programación estructurada ni favoritos |
| Jerarquía y simplicidad | 2 | Siete servicios equivalentes y confirmación con contenido secundario |
| Recuperación de errores | 3 | Recupera estados habituales; búsqueda pendiente necesita control adicional |
| Ayuda | 2 | Contenido útil con contradicción concreta en aeropuerto |
| **Total** | **26/40** | **Línea base orientativa de la cotización** |

### Carga cognitiva y personas

- Primera visita desde el aeropuerto: se pregunta si debe elegir un traslado al aeropuerto aunque necesita salir de él. La ayuda debe coincidir con el sentido del viaje.
- Uso con teclado: al activar un servicio sin origen, el foco salta al título del servicio, por debajo del campo necesario. Es reproducible; la validación llega después.
- Uso con una mano: en 375 px los botones flotantes cubren parte del contenido en ciertas posiciones de scroll. No tener desbordamiento horizontal no garantiza ausencia de solapamientos.
- Decisión inicial: siete servicios al mismo nivel y numerados como paradas; parecen una secuencia, no alternativas. El resumen añade avisos no pertinentes al pago seleccionado.

El recorrido pasa de una presentación cuidada a decisiones numerosas y termina en una espera externa. Esa ruptura explica la menor sensación de plataforma; no la falta de más animaciones.

## Prioridades concretas

### 1. Aeropuerto: corregir sentido del viaje y foco inicial — alta, pequeña

Evidencia: `templates/ayuda.html` recomienda «Traslado aéreo» para AILA → San Salvador; `selectAirport` en `js/app.js` establece el aeropuerto como destino. `activateService` enfoca el título incluso sin origen, comprobado con Enter.

Solución: opciones «Ir al aeropuerto» y «Me recogen en el aeropuerto», sincronizadas con A/B; enfocar el primer dato obligatorio faltante. No restringir recogidas al flujo genérico como solución permanente.

Terminado cuando ambos sentidos producen origen, destino, ruta y WhatsApp correctos, y el recorrido por teclado no omite el origen. No requiere cuentas externas.

### 2. Solicitud guiada, confirmación contextual y controles móviles — media, mediana

Evidencia: `templates/cotizar.html` muestra siete alternativas numeradas «Parada»; `templates/cotizar-modals.html` conserva aviso de transferencia incluso pagando en efectivo. Los flotantes pueden cubrir contenido móvil. `wireConfirmModal` alterna negociación sin `aria-expanded`/`aria-controls`; el estado del mapa no anuncia cambios mediante `aria-live`.

Solución: comenzar con intención + A/B, revelar campos por servicio, simplificar texto redundante y reservar espacio para acciones flotantes. Mantener desglose, recargos y cancelación visibles. Añadir semántica al desplegable y anuncios de estado.

Terminado con pruebas a 320/375 px, teclado, zoom, efectivo/transferencia y contenido largo sin controles tapados. Código y contenido básicos disponibles.

### 3. Búsqueda y ruta confiables antes de escalar — alta, mediana

Evidencia: `js/geo.js` limita llamadas por navegador, no por toda la aplicación. La política pública de Nominatim fija un máximo agregado de una solicitud/segundo por aplicación y prohíbe autocomplete. Enter repetido puede encolar solicitudes aunque se descarten resultados antiguos. `fetchRoute` conserva aproximación geométrica cuando falla OSRM o no hay acceso vial próximo.

Solución: deduplicar solicitudes pendientes y cancelar tareas obsoletas; proveedor de geocodificación/rutas adecuado al volumen o proxy con caché y límite global. Cuando no se confirma acceso por carretera, solicitar revisión manual sin presentar el cálculo geométrico como tarifa confiable.

Fuente: https://operations.osmfoundation.org/policies/nominatim/

Terminado con pruebas de concurrencia, repetición de Enter, timeout, destino sin acceso y estado recuperable. Para producción requiere elegir proveedor, cuenta y presupuesto; no exponer secretos en el repositorio público.

### 4. Programados y clientes recurrentes sin backend inicial — alta, mediana

Evidencia: el mensaje de aeropuerto pide confirmar hora de vuelo, pero no se captura fecha/hora como datos estructurados. El borrador local no es historial de servicios ni sistema de fidelidad.

Solución: «Ahora / Programar», fecha y hora, sentido del aeropuerto, equipaje y vuelo opcional. Favoritos y repetición local con consentimiento y opción de borrar. Llamarlos solicitudes guardadas, no viajes completados.

Terminado cuando todos los datos llegan al resumen y WhatsApp, se validan fechas pasadas y zona horaria, y se comunica que la reserva sigue pendiente de aceptación. Necesita horarios reales, anticipación mínima y reglas comerciales; se puede construir la interfaz con la arquitectura actual.

### 5. Registro de solicitudes y panel del operador — alta estratégica, grande

Evidencia: `wireConfirmModal` abre WhatsApp y guarda estado local; no existe API que registre recepción, aceptación, asignación o realización. No hay backend ni base de datos de reservas.

Solución recomendada: backend pequeño con solicitudes, eventos de estado y panel autenticado para el operador. Empezar con asignación manual, respetando el modelo del negocio. Estados mínimos: recibida, pendiente de revisión, confirmada, conductor asignado, completada y cancelada. La confirmación debe exigir operador, precio acordado y disponibilidad.

Después: enlace privado y limitado del viaje con conductor y placa asignados. GPS en vivo, portal del conductor y automatización solamente tras consolidar operación y permisos.

Terminado con control de acceso por roles, claves solo en servidor, enlaces no enumerables/caducables, auditoría, copias de seguridad y pruebas de transiciones concurrentes. Necesita proveedor de backend, responsables, presupuesto, estados de negocio y política de datos. El frontend puede seguir estático; no exige app nativa ni reescribir todo.

## Otras mejoras con valor, sin inventar resultados

- Medir inicio de cotización, ruta resuelta, revisión y apertura de WhatsApp por separado. Apertura no significa reserva ni viaje realizado. Vincular confirmados/completados únicamente cuando exista operación registrable.
- Revisar Search Console y Analytics antes de diagnosticar pérdida de tráfico. La categoría pública «Agencia de viajes» y la cobertura anunciada deben contrastarse con el propietario; no demuestran por sí solas un problema SEO.
- Validar lo que significa «verificado», disponibilidad por vehículo, horario de respuesta y respaldo real. No equiparar compromiso de terminar el viaje con póliza de seguro.
- Modularizar progresivamente cotización, mensajes, formularios y datos de negocio desde `js/app.js`; ampliar pruebas de flujos. No añadir un framework solo por tamaño del archivo.
- Reseñas automáticas: evaluar integración oficial y sus condiciones si la actualización manual deja de ser suficiente. No prometer resultados enriquecidos: Google excluye reseñas autorreferenciales de negocios del correspondiente tratamiento de estrellas. https://developers.google.com/search/docs/appearance/structured-data/review-snippet

## Qué falta del negocio

1. Conductores realmente disponibles, cobertura, horario, solicitudes diarias y quién confirma/asigna.
2. Anticipación mínima, margen de recogida en aeropuerto, equipaje, reglas de precio/negociación y cancelación definitivas.
3. Cuentas y presupuesto mensual para búsqueda/rutas y backend, si se aprueba esa etapa.
4. Acceso por invitación a Analytics/Search Console o informes agregados; no compartir contraseñas.

## Validación y límites

- 17/17 pruebas automatizadas, incluidas cuatro nuevas de reseñas: datos válidos, vacíos, escape de HTML y enlaces/calificaciones inválidos.
- `npm run check`: 12 páginas generadas sincronizadas, 14 HTML y 522 enlaces/recursos locales verificados.
- `git diff --check`: sin errores. Consola del navegador de la vista comprobada: sin errores.
- Reseñas y fuente revisadas a 1280 y 375 px, sin desbordamiento horizontal. Contraste calculado: estrellas 9,69:1; texto secundario 9,18:1 sobre el fondo comprobado.
- Detector de Impeccable: ejecutado una vez, devolvió cero entradas en modo degradado de expresiones regulares por falta de `htmlparser2`, `css-select`, `css-tree` y `domutils`. No constituye auditoría de accesibilidad ni señal de ausencia de problemas; no hubo overlay de detección.
- Sin prueba física en el teléfono del usuario, recorrido autenticado de Uber/inDrive, Lighthouse/CrUX, estudio con usuarios ni auditoría de seguridad exhaustiva. No se midió aumento de conversión.
- Ningún commit, push, PR, despliegue ni cambio de DNS. La web oficial no cambió.

## Decisiones que orientan la siguiente etapa

1. ¿Priorizar pulir cotización y programados (recomendado), o empezar el registro y panel del operador?
2. ¿Enfocar primero aeropuerto/programados (recomendado), viajes locales inmediatos, o encomiendas?
