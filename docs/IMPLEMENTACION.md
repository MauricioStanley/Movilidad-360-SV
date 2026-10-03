# Vista previa local — implementación v34

No se ha autorizado push, PR, merge ni despliegue. Rama local: `codex/auditoria-preview`.

## Plan verificable

- [x] Línea base: sintaxis y reproducción de fallos.
- [x] Cotizaciones: dirección confirmada, instantáneas, concurrencia, pasajeros y mapa.
- [x] Búsqueda explícita, errores recuperables y adaptador de proveedor.
- [x] Confirmación: validación, banco, negociación, borrador y salida a WhatsApp.
- [x] Accesibilidad: paneles, foco, movimiento, mapa por teclado y móvil.
- [x] PWA: código de actualización atómica, caché por recurso y 404 profunda.
- [x] Privacidad técnica, medición optativa y eliminación de promesas no sustentadas.
- [x] Navegación, páginas de servicios, plantillas compartidas y vista previa.
- [x] Pruebas, CI local preparada, documentación y revisión visual.

El detalle por hallazgo, las verificaciones y los límites de estas marcas están en [REVISION-LOCAL.md](REVISION-LOCAL.md). No significan una certificación de seguridad ni que las dependencias comerciales estén resueltas.

## Pendiente externo o sujeto a revisión

- [ ] Aprobación visual y autorización separada para publicar.
- [ ] Proveedor de mapas/búsqueda con cuota global o infraestructura proxy aprobada.
- [ ] Datos comerciales: mínimo, titular de cuentas, puntos exactos de tarifas fijas, verificaciones y coberturas.
- [ ] Configuración en la cuenta de Analytics y prueba PWA/actualización en dispositivos físicos.
- [ ] Backend y operación para reservas, asignación, tracking y administración, si se aprueba esa evolución.

## Decisiones que no se inventarán

- Se conservan tarifas vigentes, mínimo de $2, mascotas $1.99 y cuentas suministradas. El mínimo y las condiciones requieren aprobación comercial antes de publicar.
- No se inventan titular de cuentas, pólizas, verificaciones, disponibilidad o coordenadas de recogida.
- El sitio no confirma reservas: prepara solicitudes que el equipo acepta por WhatsApp.
- No se crean cuentas de usuarios, tracking, panel administrativo ni reservas ficticias. Esas funciones necesitan backend y decisiones operativas.
- El buscador público se contiene con búsquedas explícitas. Un control de cuota global/proveedor contratado requiere infraestructura adicional antes de crecer.
