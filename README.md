# Falcon QR Printer — El Arrecife

Sistema de recepción, gestión e impresión local de documentos para la librería e impresiones El Arrecife.

El operador descarga los documentos que el cliente envía por WhatsApp Business Desktop; el sistema los detecta,
los convierte a PDF, los analiza, los asocia al cliente y los imprime en la impresora correcta.
**Todo el procesamiento documental ocurre en una sola computadora Windows. Supabase guarda únicamente información
administrativa: ningún documento, PDF, miniatura ni vista previa sale de la computadora.**

- [Instalación en Windows](docs/INSTALACION_WINDOWS.md)
- [Manual de operación](docs/OPERACION.md)
- [Actualización, respaldo y recuperación](docs/ACTUALIZACION_Y_RECUPERACION.md)

## Arquitectura

```
                       UNA SOLA COMPUTADORA WINDOWS
┌──────────────────────────────────────────────────────────────────────────┐
│  WhatsApp Business Desktop ── "Guardar como…" ──► C:\ElArrecife\Entradas │
│                                                          │               │
│  ┌───────────────────────── AGENTE LOCAL (Node.js) ──────▼────────────┐  │
│  │ Monitor de carpeta → Conversión (LibreOffice) → Análisis PDF       │  │
│  │        │                                              │            │  │
│  │        ▼                                              ▼            │  │
│  │  SQLite local  ◄──── pedidos, cola, intentos ───► Motor de reglas  │  │
│  │  (fuente de verdad)                                   │            │  │
│  │        │                                              ▼            │  │
│  │  Retención 30 días          Cola de impresión → pdf-to-printer ──────────► Impresoras
│  │        │                                                           │  │
│  │  API http://127.0.0.1:47821 (credencial firmada + origen permitido)│  │
│  └────────┬──────────────────────────────────────────────┬────────────┘  │
│           │ estado en vivo, vista previa, órdenes        │               │
│  ┌────────▼───────────────────┐                          │               │
│  │ Navegador: panel /admin/*  │                          │               │
│  └────────┬───────────────────┘                          │               │
└───────────┼──────────────────────────────────────────────┼───────────────┘
            │ login, impresoras, reglas, ajustes           │ SOLO METADATOS
   ┌────────▼──────────────────────────────────────────────▼────────┐
   │ SUPABASE:  Auth · PostgreSQL (RLS)                              │
   │ usuarios, clientes, pedidos, impresoras, reglas, estados,       │
   │ precios, auditoría.  ✗ Sin documentos. ✗ Sin Storage.           │
   └─────────────────────────────────────────────────────────────────┘
```

### Decisiones de diseño

| Decisión | Motivo |
|---|---|
| **SQLite local es la fuente de verdad** de documentos y cola; Supabase recibe una copia de los metadatos | El negocio sigue recibiendo e imprimiendo sin internet; al reconectar se sincroniza lo pendiente |
| **SQLite integrado en Node** (`node:sqlite`, Node ≥ 22.13) | Sin binarios nativos que compilar en la PC del negocio |
| El archivo se **mueve** fuera de `Entradas` al registrarlo y se guarda por **identificador** | Un archivo no puede detectarse dos veces; nombres repetidos no se pisan |
| El panel habla con el agente por **localhost** con una credencial HMAC de corta duración que entrega el servidor Next.js | El navegador nunca ve la Service Role Key; el agente la verifica sin internet |
| El agente escucha **solo en 127.0.0.1**, valida `Origin` y `Host`, y solo acepta identificadores (nunca rutas) | No es un servicio de documentos accesible desde la red |
| **Sin reintentos automáticos de impresión**; un envío interrumpido queda "incierto" | Evitar copias dobles |
| "Enviado a cola Windows" ≠ "Impreso confirmado" | Que Windows acepte el trabajo no prueba que salió el papel |
| El tamaño se pide con el **formulario real del driver**, buscado por medidas | Oficio II no se confunde con Legal aunque el driver lo llame distinto |
| **Nunca se escala** sin una regla elegida por el operador | Evitar impresiones recortadas o reducidas por sorpresa |
| La carpeta vigilada se define en el `.env` del agente, no desde el panel | Nadie puede redirigir remotamente qué carpeta lee o borra el agente |
| Flujo QR anterior aislado en `print-agent/src/legacy-qr.js`, **apagado por defecto** | Era el único que usa Supabase Storage; no se eliminó |

## Stack tecnológico

- **Panel**: Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **Datos administrativos y auth**: Supabase (PostgreSQL + RLS + Auth)
- **Agente**: Node.js ≥ 22.13 · `node:sqlite` · chokidar · pdf-lib · pdf-to-printer (SumatraPDF)
- **Conversión**: LibreOffice headless, perfil aislado por conversión, macros bloqueadas
- **Servicio**: PM2 + tarea programada de Windows

## Estructura del proyecto

```
/
├── app/admin/
│   ├── reception/        # Recepción de documentos (bandeja, clientes, pedidos, vista previa)
│   ├── print-queue/      # Cola de impresión
│   ├── history/          # Pedidos anteriores, reimpresión, auditoría, errores, eliminados
│   ├── rules/            # Reglas de asignación de impresora
│   ├── printers/         # Impresoras y capacidades
│   ├── settings/         # Ajustes (local + precios + QR)
│   ├── agent-session.ts  # Entrega la credencial del agente al personal autenticado
│   └── print-jobs/, qr/, reports/, users/, dashboard/   # módulos existentes
├── app/print/[token]/    # Formulario público por QR (flujo heredado)
├── lib/agent/            # Cliente del agente, tipos y etiquetas
├── sql/                  # 001–006 originales · 007 deriva de esquema · 008 recepción local
├── docs/                 # Manuales
└── print-agent/
    ├── agent.js          # Punto de entrada
    ├── src/
    │   ├── intake.js     # Monitor de carpeta
    │   ├── processor.js  # Cola de conversión y análisis
    │   ├── converter.js  # LibreOffice
    │   ├── analyzer.js   # Validación y análisis de PDF
    │   ├── paper.js      # Tamaños de papel
    │   ├── planner.js    # Motor de reglas
    │   ├── orders.js     # Clientes, pedidos, autorización, reimpresión
    │   ├── queue.js      # Cola de impresión y control de duplicados
    │   ├── printers.js   # Impresoras de Windows
    │   ├── retention.js  # Retención de 30 días
    │   ├── sync.js       # Sincronización de metadatos con Supabase
    │   ├── api.js        # Servicio localhost para el panel
    │   ├── auth.js, db.js, store.js, files.js, config.js, util.js, app.js
    │   └── legacy-qr.js  # Flujo QR anterior (apagado por defecto)
    ├── scripts/          # install-windows.ps1, backup.js
    └── test/             # Pruebas automatizadas
```

Almacenamiento local (se crea solo):

```
C:\ElArrecife\
├── Entradas\      ← aquí guarda el operador las descargas de WhatsApp
├── Procesando\    ← tránsito (segundos)
├── Originales\<id>\original.docx
├── PDF\<id>\document.pdf
├── Completados\<id>\   ← pedidos entregados, hasta su eliminación
├── Errores\<id>\
├── Temporales\  Logs\  Datos\agente.db  Respaldos\
```

## Estados

```
Documento:  recibido → en cola → convirtiendo → listo ──► (pedido entregado) ──► eliminado a los 30 días
                                      └──► error ──(reintentar)──┘

Trabajo:    listo para imprimir → enviando → enviado a cola Windows → imprimiendo → impreso confirmado
                 │                    │              │
                 └─► cancelado        ├─► error ◄────┘ (el operador indica que no salió)
                                      └─► envío incierto (decide el operador)
```

## Puesta en marcha

Producción: siga [docs/INSTALACION_WINDOWS.md](docs/INSTALACION_WINDOWS.md).

Desarrollo:

```bash
# Base de datos: ejecutar sql/001 … 008 en el SQL Editor de Supabase

# Panel
cp .env.example .env.local      # Supabase + AGENT_SECRET_TOKEN
npm install
npm run dev                     # http://localhost:3000/admin/login

# Agente
cd print-agent
cp .env.example .env            # mismo AGENT_SECRET_TOKEN; PRINT_DRIVER=dryrun para no imprimir
npm install
npm start
```

Primer administrador: cree el usuario en Supabase → Authentication y luego
`UPDATE profiles SET role = 'admin' WHERE email = 'tu@email.com';`

## Pruebas

```bash
cd print-agent
npm test
```

Las pruebas usan carpetas temporales, impresoras simuladas y un Supabase simulado: no imprimen ni tocan datos reales.
Resultado en el equipo de desarrollo (Node 24, Windows 11): **44 pruebas — 43 aprobadas, 0 fallidas, 1 omitida**
(conversión real con LibreOffice, que no estaba instalado).

| # | Prueba requerida | Cobertura |
|---|---|---|
| 1–2 | PDF en la carpeta / detección automática | Automatizada |
| 3 | Descarga incompleta | Automatizada |
| 4–5 | Conversión DOC y DOCX | Flujo automatizado con convertidor simulado · **conversión real pendiente** (requiere LibreOffice) |
| 6 | Validación de PDF | Automatizada |
| 7–10 | Carta, Oficio II, Legal, A4 | Automatizada |
| 11 | Páginas mixtas | Automatizada |
| 12 | Quince archivos en un minuto | Automatizada (15 archivos listos en ≈ 1.7 s) |
| 13 | Nombres iguales | Automatizada |
| 14 | Varios documentos a un cliente | Automatizada |
| 15–16 | Impresora manual / por reglas | Automatizada |
| 17–18 | Dúplex / varias copias | Opciones enviadas al driver: automatizada · **salida física pendiente** |
| 19 | Impresora desconectada | Automatizada (simulada) · **pendiente con impresora real** |
| 20 | Reinicio del agente | Automatizada |
| 21 | Reimpresión local | Automatizada |
| 22 | Eliminación a los 30 días | Automatizada |
| 23 | Caída de internet | Automatizada |
| 24 | Nada se sube a Storage | Automatizada (análisis estático + cliente que falla si se toca Storage) |
| 25 | Flujo QR intacto | Sintaxis y funciones del agente QR verificadas; `next build` correcto · **prueba de extremo a extremo pendiente** (requiere Supabase) |

Pendiente de validar en la computadora real: impresión física en cada impresora, bandejas, formulario Oficio II,
seguimiento del trabajo en la cola de Windows, conversión con LibreOffice, y el recorrido completo del panel con
Supabase.

## Flujo QR anterior

El formulario público `/print/[token]`, la pantalla `/display` y **Trabajos QR** se conservan. Ese flujo sube los
archivos a Supabase Storage, por lo que su agente está apagado por defecto. Para usarlo: `LEGACY_QR_ENABLED=true` en
`print-agent/.env`. No comparte tablas ni cola con el flujo por carpeta.

## Seguridad

- **RLS** en todas las tablas. Las tablas del flujo local solo admiten lectura del personal; escribe únicamente el
  agente con la Service Role Key.
- La **Service Role Key** vive solo en el servidor del panel y en `print-agent/.env`; nunca llega al navegador.
- El agente escucha solo en `127.0.0.1`, exige credencial firmada, origen permitido y cabecera `Host` local.
- El navegador nunca envía ni recibe rutas del disco: solo identificadores de documento.
- Activar el modo automático requiere rol administrador; apagarlo, cualquier miembro del personal.
- Los documentos se eliminan con el borrado normal de Windows: **no es un borrado irrecuperable del disco**.

## Licencia

MIT
