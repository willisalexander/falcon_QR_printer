# Actualización, respaldo y recuperación ante errores

## Actualizar el sistema

Hágalo fuera del horario de atención.

```powershell
cd C:\ruta\falcon_QR_printer-main\print-agent
npm run backup                         # 1. respaldo del registro local
pm2 stop print-agent                   # 2. detener el agente (espera el envío en curso)

# 3. Reemplace los archivos del proyecto por la versión nueva.
#    NO borre print-agent\.env, .env.local ni C:\ElArrecife

npm ci --omit=dev                      # 4. dependencias del agente
pm2 start ecosystem.config.cjs         # 5. iniciar (la base local se actualiza sola)
pm2 save

cd ..                                  # 6. panel
npm ci
npm run build
pm2 restart panel
```

Si la versión nueva trae archivos en `sql/` con número mayor al último ejecutado, haga un respaldo en Supabase y
ejecútelos en orden **antes** del paso 5.

**Volver atrás:** detenga el agente, restaure los archivos anteriores y copie el `agente.db` del respaldo a
`C:\ElArrecife\Datos\agente.db`.

## Respaldo

| Qué | Dónde está | Cómo se respalda |
|---|---|---|
| Registro local (cola, pedidos, rutas) | `C:\ElArrecife\Datos\agente.db` | `npm run backup` (automático a diario, conserva 14) |
| Configuración del agente | `print-agent\.env` | Incluida en el respaldo como `agente.env` |
| Configuración del panel | `.env.local` | Cópiela a mano a un lugar seguro |
| Impresoras, reglas, ajustes, pedidos | Supabase | Respaldos de Supabase |
| Documentos de clientes | `C:\ElArrecife\Originales`, `PDF`, `Completados` | No se respaldan (se eliminan a los 30 días) |

Respaldo a una memoria USB: `npm run backup -- E:\`

El respaldo contiene claves de acceso: guárdelo en un lugar seguro.

## Recuperación ante errores

### El panel dice "No hay conexión con el agente local"

```powershell
pm2 status                  # ¿print-agent está online?
pm2 logs print-agent --lines 50
pm2 restart print-agent
```

- *"AGENT_SECRET_TOKEN es obligatorio"*: falta el secreto en `print-agent\.env`.
- *"Ya hay un agente ejecutándose"*: hay dos copias. `pm2 delete all`, luego `pm2 start ecosystem.config.cjs`.
- *"Sesión del agente inválida"*: el secreto del panel y el del agente no son iguales.
- *"Origen no permitido"*: agregue la dirección del panel a `ALLOWED_ORIGINS`.

### Se fue la luz o se reinició la computadora

Al iniciar sesión el agente arranca solo y:

- Recoge los archivos que quedaron en `Entradas`.
- Termina las conversiones pendientes.
- Continúa con los trabajos que estaban en cola.
- Los trabajos que estaban **a medio enviar** quedan en **Envío incierto** y no se reenvían: revise la bandeja y
  responda en **Cola de impresión → Errores**.

### Un documento queda en Error

| Mensaje | Solución |
|---|---|
| LibreOffice no está instalado | Instálelo y pulse Reintentar |
| La conversión superó el tiempo máximo | Reintentar; si persiste, suba el tiempo en Configuración o pida el PDF al cliente |
| Protegido con contraseña | Pedir copia sin contraseña |
| No es un PDF/Word válido o está dañado | Pedir que lo reenvíen |
| Supera el límite de MB | Subir el límite en Configuración y volver a guardar el archivo en Entradas |

El original de un documento con error se conserva en `C:\ElArrecife\Errores\<identificador>\`.

### Un trabajo no sale de la impresora

1. **Cola de impresión → Enviados**: si dice "Enviado", el problema está en Windows o en la impresora
   (papel, atasco, tinta). Revise la cola de Windows de esa impresora.
2. Si salió: **Confirmar impreso**. Si no salió: **No salió** → pasa a Errores → **Reenviar**.
3. *"El driver no tiene un formulario…"*: vea "Oficio II" en el manual de instalación.
4. *"La bandeja … no existe"*: corrija el nombre de la bandeja en Impresoras (use Detectar capacidades).

### Sin internet

No requiere acción. Los cambios quedan guardados en la computadora y se sincronizan al volver la conexión.

### La base local se dañó

```powershell
pm2 stop print-agent
copy C:\ElArrecife\Respaldos\respaldo-<fecha>\agente.db C:\ElArrecife\Datos\agente.db
del C:\ElArrecife\Datos\agente.db-wal, C:\ElArrecife\Datos\agente.db-shm
pm2 start print-agent
```

Los documentos recibidos después de ese respaldo siguen en el disco (`Originales\<identificador>\`) pero ya no
aparecen en el panel: cópielos de nuevo a `Entradas` para registrarlos otra vez.

### Volver a usar el sistema QR anterior

En `print-agent\.env`: `LEGACY_QR_ENABLED=true` y reinicie el agente. Ese flujo usa Supabase Storage y es
independiente del flujo por carpeta.

## Registros

- Agente: `C:\ElArrecife\Logs\agent-AAAA-MM-DD.log`
- PM2: `print-agent\logs\pm2-out.log` y `pm2-error.log`
- Panel: **Historial → Auditoría** y **Historial → Errores**
