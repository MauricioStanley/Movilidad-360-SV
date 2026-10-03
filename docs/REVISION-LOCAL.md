# Revisión local v34 — resultado y límites

La implementación queda en `codex/auditoria-preview`, sin push, PR, merge ni despliegue. La web pública no cambia. Se conservan las tarifas publicadas, placas, fotografías y cuentas suministradas por el cliente.

## Cambios visibles

- Portada más corta con CTA de cotización visible y tutorial secundario, sin eliminarlo.
- Cotizador dedicado: siete servicios, uno visible cada vez; los demás no reciben foco.
- Páginas propias para flota, empleo, ayuda y nosotros, además de seis páginas explicativas de servicios.
- Salida elegida explícitamente: ya no se usa una ubicación ficticia para calcular un viaje del cliente.
- Búsqueda local al escribir; búsqueda externa al pulsar Buscar o Enter. Errores de conexión, tiempo de espera y límite del proveedor distinguibles.
- Revisión con desglose, notas, contacto de otra persona, negociación y banco seleccionado. Editar conserva esos campos en memoria para la misma ruta.
- Aviso posterior que pide enviar el mensaje en WhatsApp y esperar confirmación; no simula una reserva ni un conductor asignado.
- Controles para recordar la ruta durante 24 horas, borrarla y permitir/desactivar estadísticas.

## Cobertura de los 39 hallazgos

| N.º | Estado local | Resolución / límite |
| --- | --- | --- |
| 1 | Implementado | Escribir otra dirección invalida el precio, mapa y acción anterior. |
| 2 | Implementado | Generación de solicitud antes de las salidas tempranas y del caso mismo punto. |
| 3 | Implementado | Encomiendas captura coordenadas y descarta respuestas que llegan tras borrar/cambiar una dirección. |
| 4 | Implementado | Tarifa fija toma pasajeros y mascota actuales al revisar. |
| 5 | Implementado | Arrastrar el marcador actualiza el punto; confirmar vuelve a leer el marcador. |
| 6 | Implementado | Origen conservado en borrador; un GPS guardado no se presenta como ubicación actual. |
| 7 | Implementado | GPS/reverso anteriores no sobrescriben una elección posterior; estado y recuperación explícitos. |
| 8 | Implementado | Origen confirmado para pasajeros; puntos A y B obligatorios en encomienda y mudanza. |
| 9 | Implementado | Departamentos orientan la búsqueda, no se usan sus centros como dirección de cobro. |
| 10 | Implementado | Distancia calculada, tiempo orientativo sin tráfico en vivo y respaldo aproximado diferenciados. |
| 11 | Implementado | Turismo conserva cada parada, incluye geometría de respaldo y declara ida sin regreso/espera/entradas. |
| 12 | Parcial | Enlaces de Waze a recogida y destino/paradas desde una instantánea. Tarifas fijas requieren coordenadas confirmadas; no se inventaron. |
| 13 | Parcial | Sin autocomplete remoto; cola y caché acotadas. Falta proveedor o proxy con cuota global para tráfico concurrente. El control local no es un rate limit global. |
| 14 | Implementado | Errores de búsqueda diferenciados, reintento, mapa alternativo y recarga de Leaflet tras fallos. |
| 15 | Implementado | Teléfono y nombre obligatorios para terceros; validación de teléfono/edad en empleo. |
| 16 | Implementado | La oferta no se incluye si se desactiva la negociación; importe validado. |
| 17 | Implementado | Copiar una cuenta selecciona ese banco; efectivo oculta las cuentas y elimina la elección. |
| 18 | Implementado | Borrador de revisión por ruta y notas actuales dentro del resumen. |
| 19 | Implementado | Cancelación de transición al cerrar el visor, protección de sesión y devolución de foco. |
| 20 | Implementado | Rejillas flexibles, campos y modales adaptados a 320/375 px, sin los anchos mínimos que desbordaban. |
| 21 | Implementado | Paneles inactivos hidden/inert; alturas abiertas sin un máximo que corte contenido. |
| 22 | Implementado | Ciclo de diálogos compartido, Escape, foco inicial/retorno y contención de Tab. Bancos y selección de vehículos usan botones. |
| 23 | Implementado | El mapa de cobertura se puede activar y volver a bloquear. Falta comprobación táctil en un teléfono físico. |
| 24 | Implementado | Controles de video, respeto a movimiento reducido/ahorro de datos y pausa fuera de vista. Se eliminó rotación automática de fotos. |
| 25 | Implementado | 404 con recursos/enlaces desde la raíz; comprobada una URL inexistente profunda. |
| 26 | Implementado en código y pruebas | Precaché falla de forma explícita y actualización espera aceptación. Falta prueba de actualización con un SW de producción real. |
| 27 | Implementado | Video/rangos e imágenes fuera de la caché del SW; recursos versionados cache-first y páginas con revalidación. |
| 28 | Implementado | Enlaces estáticos de WhatsApp válidos y alternativa sin JavaScript. |
| 29 | Implementado técnicamente | Aviso describe envío a proveedores, borradores, retención y analítica. El propietario debe revisar responsable/contacto y políticas operativas. |
| 30 | Parcial | Se quitaron garantías absolutas y sellos no sustentados. Verificación, pólizas, horario real y disponibilidad deben documentarse por el negocio. |
| 31 | Parcial | Recargos visibles, cancelación ligada al precio acordado y reserva aceptada. Se conserva mínimo de $2; falta confirmación comercial de ese valor y condiciones. |
| 32 | Implementado | Más de 4 pasajeros advierte que capacidad y vehículo necesitan confirmación; no se promete una unidad inexistente. |
| 33 | Parcial | Analítica optativa, no local, eventos separados y parámetros permitidos sin PII. Revisar medición mejorada/configuración en la cuenta de GA4. |
| 34 | Implementado | Solicitudes/clics no se presentan como viajes completados ni generan un descuento automático. |
| 35 | Implementado | Navegación por propósito, páginas propias y compatibilidad con enlaces antiguos. |
| 36 | Implementado en local | Seis páginas con contenido específico, metadatos únicos, enlaces y sitemap. La indexación solo puede comprobarse después de publicar. |
| 37 | Implementado | Pruebas de regresión, validación de HTML/assets/versiones y CI de calidad preparada, sin despliegue. |
| 38 | Mejora incremental | Reglas puras, geocodificador y diálogos separados, borrador versionado y plantilla estática común. app.js aún contiene controladores grandes; no se hizo una reescritura de framework sin necesidad. |
| 39 | Bloqueado por alcance operativo | Reserva real, tracking, administración, usuarios y asignación requieren backend, proveedor, presupuesto, roles y reglas del negocio. No se simularon esas capacidades. |

## Validaciones realizadas

- Línea base: pruebas reprodujeron fallos de pasajeros en tarifa fija y cierre del visor antes de aplicar los fixes.
- Suite automática: reglas de tramos/mínimo/mascota, coordenadas/teléfonos, borrador/expiración, respuestas tardías, anulación de encomiendas, respuesta malformada de rutas, cierre del visor, contacto conservado por ruta, Waze por paradas, GA sin actividad local y fallo atómico del precaché.
- Comprobación estática: sintaxis JS, páginas generadas sincronizadas, títulos/canonical/IDs, recursos y enlaces locales, versiones y archivos de flota. No se instala un framework o librería nueva.
- Navegador local: cotización de Metrocentro a Centro Histórico, aeropuerto, búsqueda de Plaza Presidente, encomienda con notas, mudanza, tarifa fija con 3 pasajeros y mascota ($5.99 para la base $4), validación de contacto vacío, alternar efectivo/transferencia, invalidar un destino, restaurar salida, visor/cierre rápido, ayuda y empleo.
- Escritorio y móvil de 375 y 320 px: comprobación de anchura y modales; no equivale a una certificación de accesibilidad ni a todas las combinaciones de navegador/teléfono.
- HTTP local: páginas principales 200; ruta profunda desconocida 404; video con Range devuelve 206 y los bytes solicitados.
- No se enviaron solicitudes reales al negocio ni se realizaron transferencias.

## Antes de publicar

1. Aprobación visual del usuario; por ahora está expresamente prohibido publicar.
2. Confirmación del mínimo de $2 y alcance/condiciones comerciales. No se inventa un nuevo mínimo.
3. Titular de las cuentas, documentación de verificaciones/cobertura, horario real y puntos exactos de las tarifas fijas.
4. Decisión de proveedor de búsqueda/rutas o proxy con cuotas; Nominatim público no debe tratarse como infraestructura comercial ilimitada.
5. Revisar la configuración real de Analytics y comprobar PWA/instalación/actualización en dispositivos físicos al desplegar.
6. Si se desea plataforma transaccional: decidir backend y operación antes de diseñar permisos, estados y almacenamiento. RLS, autenticación y validación de servidor solo tienen sentido cuando existan esos recursos.

## Alcance de seguridad

Las pruebas disminuyen riesgos conocidos, pero no demuestran ausencia de vulnerabilidades. No se añadieron secretos a archivos públicos, base de datos, autenticación ficticia, pagos automáticos ni integraciones sin autorización. La revisión legal del aviso y condiciones corresponde al propietario con asesoramiento pertinente.
