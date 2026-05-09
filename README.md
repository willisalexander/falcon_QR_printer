# Print QR System

Sistema web de impresión mediante código QR. Los clientes escanean un QR, suben su archivo y el administrador gestiona las impresiones desde un panel privado. Un agente local envía los trabajos aprobados directamente a las impresoras.

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                      CLIENTE                            │
│  Escanea QR → /print/[token] → Sube archivo            │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────────────┐
│                  NEXT.JS (App Router)                   │
│  /print/[token]  →  Formulario público                  │
│  /admin/*        →  Panel administrativo                │
└─────────────────────┬───────────────────────────────────┘
                      │ Supabase SDK
┌─────────────────────▼───────────────────────────────────┐
│                    SUPABASE                             │
│  Auth  │  PostgreSQL  │  Storage  │  RLS               │
└─────────────────────┬───────────────────────────────────┘
                      │ Polling (Service Role Key)
┌─────────────────────▼───────────────────────────────────┐
│             AGENTE LOCAL (Node.js)                      │
│  PC del negocio — Descarga PDF → Envía a impresora      │
└─────────────────────────────────────────────────────────┘
```

## Stack Tecnológico

- **Frontend/Backend**: Next.js 16 (App Router) + TypeScript
- **Base de datos**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Storage**: Supabase Storage
- **Estilos**: Tailwind CSS
- **Formularios**: React Hook Form + Zod
- **PDF**: pdf-lib
- **Agente**: Node.js + pdf-to-printer
- **Iconos**: Lucide React

## Estructura del Proyecto

```
/
├── app/
│   ├── print/[token]/        # Página pública (formulario QR)
│   │   ├── page.tsx
│   │   ├── print-form.tsx
│   │   └── not-found.tsx
│   ├── admin/
│   │   ├── layout.tsx        # Layout con sidebar
│   │   ├── login/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── print-jobs/
│   │   ├── printers/
│   │   ├── qr/
│   │   ├── users/
│   │   ├── reports/
│   │   └── settings/
│   ├── layout.tsx
│   ├── page.tsx              # Redirige a /admin/login
│   └── globals.css
├── components/
│   ├── ui/                   # Button, Input, Card, Badge
│   └── admin/                # Sidebar, Header
├── lib/
│   ├── supabase/
│   │   ├── client.ts         # Cliente del navegador
│   │   └── server.ts         # Cliente del servidor
│   └── utils.ts
├── types/
│   ├── database.ts           # Tipos de tablas DB
│   └── index.ts
├── sql/
│   ├── 001_schema.sql        # Tablas y enums
│   ├── 002_functions.sql     # Funciones y triggers
│   ├── 003_rls.sql           # Row Level Security + Storage
│   └── 004_seed.sql          # Datos iniciales
├── print-agent/              # Agente Node.js local
│   ├── agent.js
│   ├── package.json
│   └── .env.example
├── middleware.ts             # Protección de rutas
└── .env.example
```

## Estados de un trabajo de impresión

```
uploaded → pending_approval ──→ rejected
         ↓
       approved → printing → printed → paid
                    ↓
                  failed
```

## Instalación y Configuración

### 1. Requisitos

- Node.js 18+
- Cuenta en [Supabase](https://supabase.com) (gratuita)
- Git

### 2. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/print-qr-system.git
cd print-qr-system
```

### 3. Instalar dependencias de la web app

```bash
npm install
```

### 4. Configurar Supabase

1. Crea un nuevo proyecto en [supabase.com](https://supabase.com)
2. Ve a **SQL Editor** y ejecuta los scripts en orden:
   ```
   sql/001_schema.sql
   sql/002_functions.sql
   sql/003_rls.sql
   sql/004_seed.sql
   ```
3. Copia las credenciales desde **Settings → API**

### 5. Variables de entorno

```bash
cp .env.example .env.local
```

Edita `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 6. Crear el primer usuario administrador

1. Ve a Supabase Dashboard → **Authentication → Users**
2. Crea un usuario con **Invite user** o **Add user**
3. En **SQL Editor**, asigna el rol admin:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE email = 'tu@email.com';
   ```

### 7. Levantar el servidor de desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000/admin/login](http://localhost:3000/admin/login)

---

## Agente Local de Impresión

El agente es un proceso Node.js que corre en el PC donde están conectadas las impresoras.

### Instalación

```bash
cd print-agent
npm install
cp .env.example .env
```

Edita `print-agent/.env`:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
POLLING_INTERVAL_MS=5000
```

### Configurar impresoras en el panel admin

1. Ve a `/admin/printers`
2. Añade tus impresoras con el **nombre exacto del sistema**
3. Para ver los nombres de impresoras disponibles:
   ```bash
   cd print-agent && node -e "import('pdf-to-printer').then(m => m.getPrinters().then(console.log))"
   ```

### Iniciar el agente

```bash
cd print-agent
npm start
```

Para mantener el agente corriendo en producción, usa [PM2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start agent.js --name "print-agent"
pm2 save
pm2 startup
```

---

## GitHub — Control de Versiones

### Crear repositorio

```bash
git init
git add .
git commit -m "feat: initial Phase 1 — architecture, DB, auth, public form"
git branch -M main
git remote add origin https://github.com/tu-usuario/print-qr-system.git
git push -u origin main
```

### Estrategia de ramas

```
main              ← producción estable
├── develop       ← integración
│   ├── feat/admin-print-jobs
│   ├── feat/reports
│   ├── feat/print-agent
│   └── fix/...
```

### Commits sugeridos por fase

```bash
# Fase 1 (ya completada)
git commit -m "feat: Phase 1 — DB schema, RLS, admin login, public QR form"

# Fase 2
git commit -m "feat: Phase 2 — admin print jobs CRUD, printer management"

# Fase 3
git commit -m "feat: Phase 3 — QR management, reports module"

# Fase 4
git commit -m "feat: Phase 4 — image to PDF conversion, thumbnails"

# Fase 5
git commit -m "feat: Phase 5 — local print agent with polling"
```

---

## Fases del Proyecto

| Fase | Descripción | Estado |
|------|------------|--------|
| **1** | Arquitectura, DB, Auth, Login admin, Formulario QR | ✅ Completada |
| **2** | Panel admin: trabajos, impresoras, configuración | 🔜 Pendiente |
| **3** | QR dinámico, módulo de reportes | 🔜 Pendiente |
| **4** | Conversión imágenes→PDF, miniaturas, vista previa | 🔜 Pendiente |
| **5** | Agente local de impresión (producción) | 🔜 Pendiente |

---

## Correlativo Diario

Formato: `IMP-YYYYMMDD-NNN`

Ejemplo: `IMP-20260507-001`, `IMP-20260507-002`

Se genera automáticamente mediante la función `generate_daily_correlative()` en PostgreSQL.

---

## Seguridad

- **RLS** activado en todas las tablas
- **Anon key** solo permite INSERT en `print_jobs` (formulario público)
- **Service role key** solo en el agente local (nunca en el cliente)
- Tokens QR son hashes de 64 caracteres hexadecimales
- Middleware de Next.js valida sesión en todas las rutas `/admin/*`
- Validación de archivos: tipo MIME + tamaño configurado

---

## Licencia

MIT
