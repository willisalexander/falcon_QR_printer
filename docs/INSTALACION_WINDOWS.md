# Instalación en la computadora del negocio (Windows)

Todo se instala en **una sola computadora**: la que tiene WhatsApp Business Desktop y las impresoras.
Use siempre la **misma sesión de usuario de Windows** con la que se atiende el negocio.

## 1. Programas necesarios

| Programa | Para qué | Dónde |
|---|---|---|
| Node.js 22.13 o superior (LTS) | Ejecuta el agente y el panel | https://nodejs.org |
| LibreOffice | Convierte Word (.doc/.docx) a PDF | https://www.libreoffice.org/download/ |
| Impresoras instaladas en Windows | Con su driver del fabricante | — |

No hace falta instalar SumatraPDF: viene incluido con el agente.
No hace falta compilar nada: la base local usa el SQLite integrado en Node.js.

## 2. Base de datos (Supabase)

1. **Haga un respaldo** del proyecto (Dashboard → Database → Backups).
2. En **SQL Editor** ejecute, en este orden:
   - `sql/007_schema_drift.sql`
   - `sql/008_local_reception.sql`

Ambos scripts solo agregan columnas, tablas y ajustes; no borran ni modifican datos y pueden ejecutarse más de una vez.

## 3. Agente local

```powershell
cd C:\ruta\falcon_QR_printer-main\print-agent
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

El instalador comprueba los requisitos, instala dependencias, crea `C:\ElArrecife\` con sus carpetas,
genera `print-agent\.env` con un secreto nuevo, inicia el agente con PM2 y registra dos tareas programadas:

- **FalconPrintAgent**: inicia el agente al iniciar sesión en Windows. Nadie ejecuta comandos por la mañana.
- **FalconPrintAgentRespaldo**: respaldo diario (13:00) del registro local en `C:\ElArrecife\Respaldos`.

Después edite `print-agent\.env` y complete:

```env
SUPABASE_URL=https://su-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

y reinicie: `pm2 restart print-agent`.

> **Por qué PM2 + tarea programada y no un servicio de Windows:** un servicio corre en una sesión aislada, sin las
> impresoras del usuario ni sus drivers por usuario. La tarea "al iniciar sesión" ejecuta el agente como el operador;
> PM2 lo reinicia solo si falla. Se usa `pm2 resurrect` desde el Programador de tareas en lugar de
> `pm2-windows-startup` para no depender de un módulo adicional.

### Variables de seguridad

- `print-agent\.env` contiene la Service Role Key y el secreto del agente. El instalador deja el archivo legible
  solo para el usuario actual. No lo copie a otras computadoras ni lo suba a ningún repositorio.
- `AGENT_SECRET_TOKEN` debe ser **idéntico** en `print-agent\.env` y en `.env.local` del panel.

## 4. Panel administrativo

El panel se abre en el navegador de la misma computadora. Opción recomendada: ejecutarlo localmente.

```powershell
cd C:\ruta\falcon_QR_printer-main
copy .env.example .env.local      # complete Supabase y pegue AGENT_SECRET_TOKEN
npm ci
npm run build
pm2 start npm --name panel -- start
pm2 save
```

Abra `http://localhost:3000/admin/login`.

### Si el panel está publicado en internet (HTTPS)

Funciona, con dos pasos adicionales:

1. Agregue su dominio a `ALLOWED_ORIGINS` en `print-agent\.env` (por ejemplo `https://panel.midominio.com`) y
   reinicie el agente. El agente rechaza cualquier otro origen.
2. La primera vez, Chrome/Edge preguntará si el sitio puede **acceder a dispositivos de la red local**: acepte.
   Los navegadores permiten que una página HTTPS llame a `http://127.0.0.1` (se considera origen seguro), pero
   exigen ese permiso. Safari no lo permite: use Chrome o Edge.

El agente **nunca** es accesible desde otras computadoras: escucha solo en `127.0.0.1`.

## 5. Impresoras y reglas

1. **Impresoras → Agregar impresora**: elija el nombre exacto de Windows de la lista y pulse
   **Detectar capacidades**. Revise color, dúplex, tamaños de papel realmente cargados y bandeja de cada tamaño.
2. **Reglas → Agregar regla**, por ejemplo:

   | Orden | Cuando el documento es | Imprimir en |
   |---|---|---|
   | 10 | Carta · B/N | Láser carta |
   | 20 | Oficio II · B/N | Láser oficio |
   | 30 | Legal · B/N | Láser oficio |
   | 40 | Carta · Color | Tinta color |

### Oficio II (8.5 × 13 in)

Oficio II **no es Legal** (8.5 × 14 in). Muchos drivers no traen ese formulario. Si al imprimir aparece
*"El driver no tiene un formulario Oficio II"*:

1. Windows → Impresoras y escáneres → **Propiedades del servidor de impresión** → pestaña **Formularios**.
2. Cree un formulario nuevo de **21.59 × 33.02 cm** (8.5 × 13 in) con cualquier nombre.
3. Vuelva a **Detectar capacidades** en el panel.

El sistema reconoce el formulario por sus medidas, no por su nombre.

## 6. WhatsApp Business Desktop

En cada descarga elija **Guardar como…** → `C:\ElArrecife\Entradas`. (Puede anclar esa carpeta en Acceso rápido.)
Los archivos desaparecen de esa carpeta en segundos: el sistema los mueve a su almacenamiento interno.

## 7. Verificación

```powershell
pm2 status                 # print-agent: online
pm2 logs print-agent       # "LibreOffice encontrado", "Carpeta vigilada: ..."
cd print-agent
npm test                   # 44 pruebas (no imprimen nada); con LibreOffice instalado no se omite ninguna
```

Prueba manual mínima, con cada impresora (**pendiente de validar en el equipo real**):

1. Copie un PDF a `C:\ElArrecife\Entradas` → aparece en **Recepción** sin recargar.
2. Asigne cliente, 1 copia, B/N, simple → **Autorizar impresión** → sale en la impresora esperada.
3. Repita con un Word, con dúplex, con 3 copias, con Oficio II y con color.
4. Apague una impresora y autorice → el trabajo queda "En espera de impresora"; enciéndala → imprime.
5. En **Cola de impresión → Enviados** compruebe si el estado pasa a "Imprimiendo" (depende del driver).
