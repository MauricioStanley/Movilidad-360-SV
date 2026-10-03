# Movilidad 360 SV

Sitio estático de transporte. La web calcula referencias de precio y prepara solicitudes para WhatsApp; **no asigna conductores ni confirma reservas automáticamente**.

## Vista previa local

Requiere Node.js 20 o posterior; no hay dependencias que instalar.

```sh
npm run build
npm test
npm run check
npm start
```

Abre `http://127.0.0.1:8777/`. El servidor escucha únicamente en este equipo. Analytics y service worker están desactivados en localhost. No publica nada.

## Dónde editar

- `templates/layout.html`: navegación, cabecera, pie y recursos compartidos.
- `templates/pages.json`: títulos, descripciones, rutas y configuración de las 12 páginas generadas.
- `templates/*.html`: contenido de cada página y modales. Después ejecuta `npm run build`.
- `js/data.js`: tarifas, flota, cuentas bancarias, preguntas frecuentes y catálogo. Es **público**, nunca guardar secretos aquí.
- `js/core.js`: cálculos y validaciones puras.
- `js/planner.js`, `js/request-options.js`: planificación, equipaje y rutas guardadas voluntariamente.
- `js/geo.js`: geocodificación con búsqueda explícita, errores y caché acotada.
- `js/ui.js`: ciclo de vida accesible de diálogos.
- `js/app.js`: controladores del cotizador, mapas y flota.
- `js/site.js`, `js/ga.js`, `js/enhance.js`: navegación, consentimiento/medición y movimiento.
- `css/styles.css`: identidad base; `css/preview.css`: composición y mejoras de la versión 36.
- `privacy.html`, `404.html`: páginas independientes.

Los HTML públicos generados se conservan para que GitHub Pages pueda servirlos sin un servidor Node. No los edites directamente: el compilador estático los regenera. `npm run check` detecta si las plantillas y sus salidas difieren.

## Publicación

La versión 36 fue aprobada para publicación el 3 de octubre de 2026. GitHub Pages sirve la raíz de `main` en `https://movilidad360sv.com/`. El flujo `.github/workflows/quality.yml` ejecuta pruebas y comprobaciones en los PR y en `main`; el despliegue lo realiza la integración existente de GitHub Pages al actualizar `main`.

Antes de cada publicación: revisar los límites pendientes, actualizar todos los recursos versionados junto con `CACHE_NAME` y `SHELL_FILES` cuando cambien, ejecutar build/test/check y obtener aprobación. Después de fusionar, verificar el estado del despliegue y las páginas públicas. No hace falta cambiar dominio, DNS o CNAME para publicar contenido.

Las notas de `docs/MEJORAS-V36.md` documentan el estado y la validación de la vista previa antes de recibir la autorización de publicación; sus pendientes operativos siguen vigentes.

## Límites operativos

OSRM y Nominatim públicos no ofrecen el SLA de una plataforma comercial. El límite por navegador **no es una cuota global**. Para tráfico concurrente hace falta seleccionar un proveedor adecuado o desplegar un proxy con control global; cambiar solo la URL también exige revisar la CSP.

El frontend no puede garantizar tarifas, autenticar conductores ni proteger una base de datos inexistente. Cuentas, reservas reales, tracking y panel de administración requieren backend, permisos, operación y pruebas adicionales. Los datos del formulario no se envían a Analytics.
