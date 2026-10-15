# Manual breve de operación

## El flujo de cada día

1. El cliente envía sus documentos por WhatsApp.
2. En WhatsApp Desktop: **Guardar como…** → `C:\ElArrecife\Entradas`.
3. En el panel, **Recepción**: el documento aparece solo, se convierte a PDF y se analiza.
4. Haga clic en el documento: se abre una ventana, escriba el nombre del cliente y **Enter**.
   Para varios documentos del mismo cliente, marque antes sus casillas.
5. Indique copias, color y caras. Revise la impresora sugerida.
6. **Autorizar impresión** (ícono de impresora de la fila, o Enter).
7. Al entregar y cobrar: **Entregado**.

Guardar un archivo en la carpeta **nunca imprime por sí solo**.

## Recepción con teclado (horas pico)

Haga clic una vez en la tabla y use:

| Tecla | Acción |
|---|---|
| ↑ ↓ | Moverse entre documentos (con Mayús, selecciona) |
| Espacio | Seleccionar / quitar |
| Ctrl + A | Seleccionar todos |
| C | Abrir la ventana del cliente → escriba el nombre → Enter |
| 1 … 9 | Copias |
| B / K | Blanco y negro / Color |
| S / D | Simple / Dúplex |
| X | Lo más común: 1 copia, B/N, simple |
| V | Ver el PDF tal como se imprimirá |
| Enter | Autorizar impresión |
| Esc | Limpiar selección |

Las teclas actúan sobre **lo seleccionado**; si no hay selección, sobre la fila marcada.

## La ventana del cliente

- Se abre sola al hacer clic en un documento **sin cliente**. En uno que ya tiene cliente se abre con la tecla **C**,
  con el nombre actual listo para corregirlo.
- **Enter** asigna; **Esc** cancela; **Mayús + Enter** crea un pedido aparte aunque el cliente ya tenga uno abierto.
- El nombre se guarda tal como lo escribe. El sistema reconoce al mismo cliente aunque cambien mayúsculas o acentos.
- Si hay casillas marcadas, el nombre se aplica a todos los documentos marcados.
- **Quitar del pedido** (dentro de la ventana) devuelve el documento a "Pendientes de identificación".
- Para **descartar** un documento use la papelera al final de su fila.

## Qué significa cada estado

**Documentos**

| Estado | Qué hacer |
|---|---|
| En cola / Convirtiendo | Esperar unos segundos |
| Pendiente de identificación | Asignar cliente |
| Faltan datos | Completar lo que indica el texto amarillo |
| Listo para autorizar | Autorizar |
| Error | Leer el motivo; **Reintentar** (↻) o pedir otro archivo al cliente |

**Trabajos de impresión**

| Estado | Significado |
|---|---|
| Listo para imprimir | En cola, sale en su turno |
| En espera de impresora | La impresora está apagada o desconectada. Sale al volver (máx. 10 min) |
| Enviado a cola Windows | Windows lo aceptó. **Todavía no significa que salió el papel** |
| Imprimiendo | Se ve dentro de la cola de Windows |
| Impreso confirmado | Usted lo confirmó, o marcó el pedido como Entregado |
| Envío incierto | El sistema no sabe si salió. **Mire la bandeja** y responda "Sí se imprimió" o "No se imprimió" |
| Error | No salió. Corrija la causa y use **Reenviar** |

El sistema **nunca reenvía solo** un trabajo: así no salen copias dobles.

## Casos frecuentes

- **Word que se ve distinto:** LibreOffice puede mover saltos de página o fuentes. Pulse **V** antes de autorizar.
- **Documento con páginas de varios tamaños:** elija *Separar por tamaño* (cada grupo va a su impresora) o
  *Ajustar a un tamaño*.
- **El cliente quiere otro papel:** elija el papel y luego la **regla de ajuste**. Sin regla no se imprime:
  el sistema no escala por su cuenta.
- **"Mismo contenido que un documento recibido antes":** el cliente reenvió el archivo. Decida si imprimirlo o
  **Descartar**.
- **Ninguna regla coincide:** elija la impresora a mano en la columna Impresora.
- **Archivo con contraseña:** pida al cliente una copia sin contraseña.
- **Me equivoqué de cliente:** marque el documento, pulse **C** y escriba el cliente correcto (solo antes de imprimir).

## Reimprimir

**Historial → Pedidos anteriores** → busque por cliente, correlativo o nombre de archivo → **Reimprimir**.
Verá la configuración anterior y puede cambiar copias, color, caras, papel e impresora.

Elija el tipo de reimpresión:

- **Sin cobro** (viene marcado): corrección para el mismo cliente, por ejemplo si la hoja salió manchada.
  Queda dentro del pedido original y no suma a ingresos.
- **Cobrar como pedido nuevo**: otra persona pide el mismo documento. Escriba su nombre; se crea un pedido nuevo
  con su propio correlativo y se manda a imprimir. Ese pedido aparece en **Recepción**: al cobrar, márquelo
  **Entregado** y entonces suma a ingresos y a Reportes. Si la impresión salió mal, puede cancelarlo ahí mismo.

Solo funciona en esta computadora y mientras el documento no haya sido eliminado. Cada pedido muestra su
**fecha prevista de eliminación**; use **Conservar** para que un pedido no se elimine.

## Autorizar la impresión

El sistema trabaja siempre en **modo supervisado**: nada se imprime sin autorización del operador.

- Un documento: ícono de impresora al final de su fila.
- Varios a la vez: marque sus casillas y pulse **Enter**.

El modo automático existe en el agente pero no se ofrece en el panel. Si alguna vez la franja superior mostrara
"Modo AUTOMÁTICO", pulse **Apagar automático** (botón rojo): lo detiene al instante, incluso sin internet.

## Conservación de documentos

- Se guardan **30 días** después de marcar el pedido como Entregado o Cancelado (configurable en Configuración).
- Los pedidos abiertos **no** se eliminan nunca.
- Después se elimina el archivo; queda el registro del pedido (cliente, páginas, precio, fechas).
- **Historial → Documentos eliminados** muestra qué se eliminó y cuándo.

## Sin internet

Puede seguir recibiendo e imprimiendo con la pantalla que ya tenga abierta. La franja superior mostrará
"Sin internet — N cambios por sincronizar"; se suben solos al volver la conexión.
Para iniciar sesión en el panel sí se necesita internet.
