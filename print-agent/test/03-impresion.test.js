import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeAgent, makePdf, PRINTERS, sleep, waitFor } from "./helpers.js";

const DAY = 86400000;

/** Deja N PDF y los asocia a un cliente con instrucciones completas. */
async function seed(t, { files = [["carta"]], customer = "María López", patch = { copies: 1, color_mode: "bw", duplex: "simplex" } } = {}) {
  const before = t.docs().length;
  for (let i = 0; i < files.length; i++) await t.drop(`doc-${before + i}.pdf`, await makePdf(files[i]));
  await t.waitReady(before + files.length);
  const ids = t.docs().slice(before).map((d) => d.id);
  const { body } = await t.api("POST", "/api/documents/assign", { ids, customerName: customer });
  if (patch) await t.api("POST", "/api/documents/update", { ids, patch });
  return { ids, orderId: body.orderId };
}

test("modo supervisado: varios documentos de un cliente, nada se imprime sin autorización", async () => {
  const t = await makeAgent();
  try {
    const { ids, orderId } = await seed(t, { files: [["carta"], ["legal", "legal"], ["carta"]] });
    const state = (await t.api("GET", "/api/state")).body;
    assert.equal(state.mode, "supervised");
    assert.equal(state.orders.length, 1);
    assert.equal(state.orders[0].customer_name, "María López");
    assert.match(state.orders[0].correlative, /^ARR-\d{8}-001$/);
    assert.ok(state.documents.every((d) => d.order_id === orderId));
    // El sistema muestra la impresora recomendada pero espera al operador.
    assert.deepEqual(state.documents.map((d) => d.plan.parts[0].printerName), ["Láser Carta", "Láser Legal", "Láser Carta"]);
    assert.equal(state.orders[0].total_price, 2); // 4 páginas × Q0.50
    await sleep(1800);
    assert.equal(t.printDriver.calls.length, 0);

    const res = await t.api("POST", `/api/orders/${orderId}/authorize`);
    assert.ok(res.body.results.every((r) => r.ok));
    await t.waitJobs("sent", 3);
    assert.equal(t.printDriver.calls.length, 3);
    assert.deepEqual(t.printDriver.calls.map((c) => c.options.printer), ["HP Carta", "HP Legal", "HP Carta"]);
    assert.deepEqual(t.printDriver.calls.map((c) => c.options.paperSize), ["Letter", "Legal", "Letter"]);
    assert.equal(ids.length, 3);
  } finally {
    await t.close();
  }
});

test("instrucciones ambiguas no se imprimen; un cliente ya registrado se reutiliza", async () => {
  const t = await makeAgent();
  try {
    const { ids, orderId } = await seed(t, { patch: null });
    const r = await t.api("POST", "/api/documents/authorize", { ids });
    assert.equal(r.body.results[0].ok, false);
    assert.equal(r.body.results[0].problems.length, 3, "faltan copias, color y dúplex");
    assert.equal(t.jobs().length, 0);

    const again = await seed(t, { customer: "  maria   lopez ", patch: null });
    assert.equal(again.orderId, orderId, "mismo cliente (sin importar mayúsculas/acentos) → mismo pedido abierto");
    assert.equal((await t.api("GET", "/api/customers?q=mari")).body.customers.length, 1);
    // Un pedido nuevo muestra el nombre tal como se escribió, sin duplicar al cliente.
    const typed = await seed(t, { customer: "maria LOPEZ" , patch: null });
    await t.api("POST", "/api/documents/assign", { ids: typed.ids, customerName: "maria LOPEZ", newOrder: true });
    const names = t.ctx.db.all("SELECT customer_name FROM orders WHERE status = 'open' ORDER BY created_at").map((o) => o.customer_name);
    assert.deepEqual(names, ["María López", "maria LOPEZ"]);
    assert.equal(t.ctx.db.all("SELECT * FROM customers").length, 1);
    await t.api("POST", "/api/documents/discard", { ids: typed.ids });

    // Modificar la asociación: pasar el documento a otro cliente.
    const moved = await t.api("POST", "/api/documents/assign", { ids: again.ids, customerName: "Pedro Ixcoy" });
    assert.notEqual(moved.body.orderId, orderId);
    assert.equal(t.ctx.db.all("SELECT * FROM orders WHERE status = 'open'").length, 2);
  } finally {
    await t.close();
  }
});

test("opciones de impresión: copias, dúplex, color, bandeja y selección manual de impresora", async () => {
  const t = await makeAgent();
  try {
    const { ids } = await seed(t, { files: [["carta", "carta"], ["carta"], ["carta"]], patch: null });
    await t.api("POST", "/api/documents/update", { ids: [ids[0]], patch: { copies: 5, color_mode: "bw", duplex: "long", notes: "engrapar" } });
    await t.api("POST", "/api/documents/update", { ids: [ids[1]], patch: { copies: 2, color_mode: "color", duplex: "simplex" } });
    // Selección manual: B/N en la impresora de color aunque la regla diga otra cosa.
    await t.api("POST", "/api/documents/update", { ids: [ids[2]], patch: { copies: 1, color_mode: "bw", duplex: "simplex", printer_id: PRINTERS.color.id } });
    const bad = await t.api("POST", "/api/documents/update", { ids, patch: { copies: 0 } });
    assert.equal(bad.status, 400);

    await t.api("POST", "/api/documents/authorize", { ids });
    await t.waitJobs("sent", 3);
    const [a, b, c] = t.printDriver.calls.map((x) => x.options);
    assert.deepEqual([a.printer, a.copies, a.side, a.monochrome, a.bin, a.scale], ["HP Carta", 5, "duplexlong", true, "Bandeja 1", "noscale"]);
    assert.deepEqual([b.printer, b.copies, b.side, b.monochrome], ["Canon Color", 2, "simplex", false]);
    assert.deepEqual([c.printer, c.monochrome], ["Canon Color", true]);
    assert.equal(t.jobs()[0].price, 5); // 2 páginas × 5 copias × Q0.50
    assert.equal(t.jobs()[1].price, 4); // 1 página × 2 copias × Q2.00
  } finally {
    await t.close();
  }
});

test("páginas mixtas: revisión del operador y separación en trabajos por tamaño", async () => {
  const t = await makeAgent();
  try {
    const { ids } = await seed(t, { files: [["carta", "carta", "legal", "carta"]] });
    const r1 = await t.api("POST", "/api/documents/authorize", { ids });
    assert.match(r1.body.results[0].problems.join(" "), /tamaños distintos/);
    await t.api("POST", "/api/documents/update", { ids, patch: { mixed_strategy: "split" } });
    await t.api("POST", "/api/documents/authorize", { ids });
    await t.waitJobs("sent", 2);
    assert.deepEqual(t.printDriver.calls.map((c) => [c.options.printer, c.options.pages, c.options.paperSize]),
      [["HP Carta", "1-2,4", "Letter"], ["HP Legal", "3", "Legal"]]);
  } finally {
    await t.close();
  }
});

test("control de duplicados: doble clic, doble autorización y trabajador concurrente imprimen una sola vez", async () => {
  const t = await makeAgent();
  try {
    const { ids, orderId } = await seed(t);
    const results = await Promise.all([
      t.api("POST", "/api/documents/authorize", { ids }),
      t.api("POST", "/api/documents/authorize", { ids }),
      t.api("POST", `/api/orders/${orderId}/authorize`).catch(() => null),
    ]);
    assert.equal(results.filter((r) => r?.body?.results?.[0]?.ok).length, 1);
    await Promise.all([t.ctx.queue.tick(), t.ctx.queue.tick(), t.ctx.queue.tick()]);
    await t.waitJobs("sent", 1);
    await sleep(1700);
    assert.equal(t.printDriver.calls.length, 1);
    assert.equal(t.jobs().length, 1);
    const attempts = t.ctx.db.all("SELECT * FROM print_attempts");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].outcome, "sent");
    // Volver a autorizar tras enviado: se rechaza y se remite a Reimprimir.
    const again = await t.api("POST", "/api/documents/authorize", { ids });
    assert.match(again.body.results[0].problems[0], /Reimprimir/);
    // Enviado no es impreso: hace falta confirmación.
    assert.equal(t.jobs()[0].status, "sent");
    assert.equal(t.jobs()[0].confirmed_at, null);
    await t.api("POST", `/api/jobs/${t.jobs()[0].id}/confirm`);
    assert.equal(t.jobs()[0].status, "printed");
  } finally {
    await t.close();
  }
});

test("impresora desconectada: el trabajo espera, no se pierde, y sale cuando vuelve", async () => {
  const t = await makeAgent();
  try {
    t.printerService.offline.add("HP Carta");
    const { ids } = await seed(t);
    await t.api("POST", "/api/documents/authorize", { ids });
    await waitFor(() => t.jobs()[0]?.hold_reason);
    assert.equal(t.jobs()[0].status, "ready");
    assert.match(t.jobs()[0].hold_reason, /no disponible/);
    assert.equal(t.printDriver.calls.length, 0);
    // Un trabajo que aún no se envió puede cancelarse; uno enviado no.
    t.printerService.offline.clear();
    await t.waitJobs("sent", 1);
    assert.equal(t.printDriver.calls.length, 1);
    assert.equal((await t.api("POST", `/api/jobs/${t.jobs()[0].id}/cancel`)).status, 409);
  } finally {
    await t.close();
  }
});

test("impresora ausente demasiado tiempo → error registrado; fallo de Windows → error sin reintento automático", async () => {
  const t = await makeAgent();
  try {
    t.printerService.offline.add("HP Carta");
    const { ids } = await seed(t);
    await t.api("POST", "/api/documents/authorize", { ids });
    await waitFor(() => t.jobs()[0]?.hold_since);
    t.ctx.db.run("UPDATE print_jobs SET hold_since = ?", new Date(Date.now() - 11 * 60000).toISOString());
    await t.waitJobs("error", 1);
    assert.match(t.jobs()[0].error_message, /no estuvo disponible/);

    t.printerService.offline.clear();
    t.printDriver.behavior = "fail";
    const { jobId } = (await t.api("POST", `/api/jobs/${t.jobs()[0].id}/resend`)).body;
    await waitFor(() => t.jobs().find((j) => j.id === jobId)?.status === "error");
    await sleep(3200);
    assert.equal(t.printDriver.calls.length, 1, "no hubo reintentos automáticos");
    const failed = t.jobs().find((j) => j.id === jobId);
    assert.match(failed.error_message, /rechazó/);
    assert.equal(failed.retry_of, t.jobs()[0].id, "el reenvío manual conserva la trazabilidad");
    assert.equal((await t.api("GET", "/api/history/errors")).body.jobs.length, 2);
  } finally {
    await t.close();
  }
});

test("envío incierto: tiempo agotado o reinicio a medio envío no se reenvía solo", async () => {
  const t1 = await makeAgent();
  t1.printDriver.behavior = "hang";
  const { ids, orderId } = await seed(t1);
  await t1.api("POST", "/api/documents/authorize", { ids });
  await t1.waitJobs("unknown", 1);
  assert.match(t1.jobs()[0].error_message, /Verifique si salió el papel/);
  assert.equal((await t1.api("POST", `/api/jobs/${t1.jobs()[0].id}/resend`)).status, 409, "incierto no se reenvía sin verificar");
  assert.equal((await t1.api("POST", `/api/orders/${orderId}/finish`)).status, 409);

  // Segundo documento: el agente "cae" justo durante el envío.
  const second = await seed(t1, { customer: "Otro Cliente" });
  await t1.api("POST", "/api/documents/authorize", { ids: second.ids });
  await waitFor(() => t1.jobs().some((j) => j.status === "sending"));
  const queued = await seed(t1, { customer: "Tercero" });
  t1.ctx.db.run(
    `INSERT INTO print_jobs (id, document_id, order_id, page_count, copies, color_mode, duplex, paper_size, scale_mode,
       printer_name, printer_system_name, batch_at, status, created_at, updated_at)
     VALUES ('77777777-7777-4777-8777-777777777777', ?, ?, 1, 1, 'bw', 'simplex', 'carta', 'noscale', 'Láser Carta', 'HP Carta', ?, 'ready', ?, ?)`,
    queued.ids[0], queued.orderId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  t1.ctx.db.close(); // corte abrupto: la base queda con un envío a medias
  await t1.ctx.intake.stop();
  await t1.ctx.queue.stop();
  t1.ctx.retention.stop();
  await t1.ctx.api.close();

  const t2 = await makeAgent({ baseDir: t1.dir });
  try {
    await waitFor(() => t2.jobs().filter((j) => j.status === "unknown").length === 2);
    await t2.waitJobs("sent", 1);
    assert.equal(t2.printDriver.calls.length, 1, "tras reiniciar solo sale lo que estaba en cola, no lo incierto");
    assert.equal(t2.jobs().find((j) => j.id.startsWith("7777")).status, "sent", "la cola pendiente se recupera");
    const open = t2.ctx.db.all("SELECT * FROM print_attempts WHERE outcome IS NULL");
    assert.equal(open.length, 0);
    // El operador verifica que no salió y entonces sí puede reenviar.
    const unknown = t2.jobs().find((j) => j.status === "unknown");
    await t2.api("POST", `/api/jobs/${unknown.id}/not-printed`);
    assert.equal((await t2.api("POST", `/api/jobs/${unknown.id}/resend`)).status, 200);
    await t2.waitJobs("sent", 2);
  } finally {
    await t2.close();
  }
});

test("cola: prioridad manual y documentos de un mismo cliente siempre juntos", async () => {
  const t = await makeAgent();
  try {
    t.printerService.offline.add("HP Carta");
    const a = await seed(t, { files: [["carta"], ["carta"]], customer: "Cliente A" });
    const b = await seed(t, { files: [["carta"], ["carta"]], customer: "Cliente B" });
    // Autorizaciones intercaladas de A y B.
    await t.api("POST", "/api/documents/authorize", { ids: [a.ids[0]] });
    await t.api("POST", "/api/documents/authorize", { ids: [b.ids[0]] });
    await t.api("POST", "/api/documents/authorize", { ids: [a.ids[1]] });
    await t.api("POST", "/api/documents/authorize", { ids: [b.ids[1]] });
    await t.api("POST", `/api/orders/${b.orderId}/update`, { priority: 5 });
    t.printerService.offline.clear();
    await t.waitJobs("sent", 4);
    const order = t.printDriver.calls.map((c) => {
      const job = t.jobs().find((j) => c.file.includes(j.id.slice(0, 8)));
      return job.order_id === a.orderId ? "A" : "B";
    });
    assert.deepEqual(order.slice(0, 2), ["B", "B"], "el pedido priorizado sale primero y completo");
  } finally {
    await t.close();
  }
});

test("modo automático: imprime solo con todas las condiciones y se apaga al instante", async () => {
  const t = await makeAgent({ settings: { print_mode: "auto" } });
  try {
    // Sin cliente → no imprime.
    const repeated = await makePdf(["carta"]);
    await t.drop("suelto.pdf", repeated);
    await t.waitReady(1);
    // Con cliente e instrucciones, pero pedido no marcado completo → no imprime.
    const a = await seed(t, { customer: "Ana" });
    // Pedido completo pero sin instrucciones → no imprime.
    const b = await seed(t, { customer: "Beto", patch: null });
    await t.api("POST", `/api/orders/${b.orderId}/update`, { is_complete: true });
    // Pedido completo, sin regla válida (legal a color) → no imprime.
    const c = await seed(t, { customer: "Caro", files: [["legal"]], patch: { copies: 1, color_mode: "color", duplex: "simplex" } });
    await t.api("POST", `/api/orders/${c.orderId}/update`, { is_complete: true });
    // Pedido completo y con instrucciones, pero contenido repetido → requiere revisión, no imprime solo.
    await t.drop("repetido.pdf", repeated);
    await t.waitReady(5);
    const dupId = t.docs().at(-1).id;
    const d = await t.api("POST", "/api/documents/assign", { ids: [dupId], customerName: "Dani" });
    await t.api("POST", "/api/documents/update", { ids: [dupId], patch: { copies: 1, color_mode: "bw", duplex: "simplex" } });
    await t.api("POST", `/api/orders/${d.body.orderId}/update`, { is_complete: true });
    await sleep(2000);
    assert.equal(t.printDriver.calls.length, 0);

    // Impresora no disponible → espera; al volver, imprime.
    t.printerService.offline.add("HP Carta");
    await t.api("POST", `/api/orders/${a.orderId}/update`, { is_complete: true });
    await sleep(1800);
    assert.equal(t.jobs().length, 0);
    t.printerService.offline.clear();
    await t.waitJobs("sent", 1);
    assert.equal(t.jobs()[0].authorized_by, "automático");
    await sleep(1800);
    assert.equal(t.printDriver.calls.length, 1, "un trabajo ya enviado no se vuelve a enviar");

    // Interruptor: vuelve a supervisado de inmediato.
    const off = await t.api("POST", "/api/print-mode", { mode: "supervised" });
    assert.equal(off.body.mode, "supervised");
    await t.api("POST", "/api/documents/update", { ids: b.ids, patch: { copies: 1, color_mode: "bw", duplex: "simplex" } });
    await sleep(1800);
    assert.equal(t.printDriver.calls.length, 1, "en supervisado ya no imprime solo");
  } finally {
    await t.close();
  }
});

test("reimpresión local: usa el PDF guardado, deja trazabilidad y avisa si ya se eliminó", async () => {
  const t = await makeAgent();
  try {
    const { ids, orderId } = await seed(t, { patch: { copies: 2, color_mode: "bw", duplex: "simplex" } });
    await t.api("POST", "/api/documents/authorize", { ids });
    await t.waitJobs("sent", 1);
    assert.equal((await t.api("POST", `/api/orders/${orderId}/finish`)).status, 200);
    assert.equal(t.jobs()[0].status, "printed", "entregar el pedido confirma lo enviado");
    assert.ok(existsSync(join(t.dir, "Completados", ids[0], "original.pdf")), "al finalizar se archiva en Completados");

    const hist = (await t.api("GET", "/api/history/orders?q=maria")).body.orders;
    assert.equal(hist.length, 1);
    assert.equal(hist[0].documents[0].pdf_available, true);
    assert.ok(hist[0].purge_after, "se muestra la fecha prevista de eliminación");
    const detail = (await t.api("GET", `/api/documents/${ids[0]}`)).body;
    assert.equal(detail.jobs[0].copies, 2, "se muestra la configuración anterior");

    // Reimprimir cambiando copias e impresora.
    const re = await t.api("POST", `/api/documents/${ids[0]}/reprint`, { copies: 1, printer_id: PRINTERS.color.id });
    assert.equal(re.status, 200);
    await waitFor(() => t.jobs().filter((j) => j.kind === "reprint" && j.status === "sent").length === 1);
    const last = t.printDriver.calls.at(-1).options;
    assert.deepEqual([last.printer, last.copies], ["Canon Color", 1]);
    assert.equal(t.ctx.db.all("SELECT * FROM print_attempts").length, 2);
    assert.equal(t.docs()[0].copies, 2, "la reimpresión no altera la configuración original");

    // Vencido el plazo, el PDF ya no existe: se informa.
    t.ctx.db.run("UPDATE orders SET finished_at = ?", new Date(Date.now() - 31 * DAY).toISOString());
    t.ctx.db.run("UPDATE print_jobs SET sent_at = ?, status = 'printed'", new Date(Date.now() - 31 * DAY).toISOString());
    await t.ctx.retention.run();
    const gone = await t.api("POST", `/api/documents/${ids[0]}/reprint`, {});
    assert.equal(gone.status, 410);
    assert.match(gone.body.error, /no está disponible/);
    assert.equal((await t.api("GET", `/api/documents/${ids[0]}/pdf`)).status, 404);
  } finally {
    await t.close();
  }
});

test("reimpresión cobrada: pedido nuevo para otro cliente, independiente del original, que suma al entregar", async () => {
  const t = await makeAgent();
  try {
    const { ids, orderId } = await seed(t, { files: [["carta", "carta"]], customer: "Cliente Original", patch: { copies: 1, color_mode: "bw", duplex: "simplex" } });
    await t.api("POST", "/api/documents/authorize", { ids });
    await t.waitJobs("sent", 1);
    await t.api("POST", `/api/orders/${orderId}/finish`);

    // Sin nombre de cliente o con configuración imposible no se crea nada.
    assert.equal((await t.api("POST", `/api/documents/${ids[0]}/reprint`, { charge: true, customerName: " " })).status, 400);
    assert.equal((await t.api("POST", `/api/documents/${ids[0]}/reprint`, { charge: true, customerName: "Otra", duplex: "long", printer_id: PRINTERS.color.id })).status, 422);
    assert.equal(t.docs().length, 1);
    assert.equal(t.ctx.db.all("SELECT * FROM orders").length, 1);

    const r = await t.api("POST", `/api/documents/${ids[0]}/reprint`, { charge: true, customerName: "Otra Persona", copies: 3, color_mode: "color" });
    assert.equal(r.status, 200);
    assert.equal(r.body.authorized, true);
    await t.waitJobs("sent", 1);

    const copy = t.docs().find((d) => d.id === r.body.documentId);
    const order = t.ctx.db.get("SELECT * FROM orders WHERE id = ?", r.body.orderId);
    assert.notEqual(order.id, orderId);
    assert.deepEqual([order.customer_name, order.status, order.total_price], ["Otra Persona", "open", 12]); // 2 pág × 3 × Q2.00
    assert.match(order.correlative, /^ARR-\d{8}-002$/);
    assert.match(order.notes, /Reimpresión de "doc-0.pdf" \(pedido ARR-\d{8}-001\)/);
    assert.deepEqual([copy.order_id, copy.duplicate_of, copy.copies, copy.color_mode, copy.page_count], [order.id, ids[0], 3, "color", 2]);
    assert.ok(existsSync(join(t.dir, "Originales", copy.id, "original.pdf")), "tiene su propia copia del PDF");
    const job = t.jobs().find((j) => j.document_id === copy.id);
    assert.deepEqual([job.kind, job.order_id, job.price, job.copies], ["print", order.id, 12, 3], "es una impresión cobrada, no una corrección");
    // Aparece en Recepción como cualquier pedido abierto.
    const state = (await t.api("GET", "/api/state")).body;
    assert.deepEqual(state.orders.map((o) => o.customer_name), ["Otra Persona"]);
    assert.deepEqual(state.documents.map((d) => d.id), [copy.id]);

    // El pedido original no cambió.
    const original = t.ctx.db.get("SELECT * FROM orders WHERE id = ?", orderId);
    assert.deepEqual([original.status, original.total_price, t.docs()[0].copies], ["finished", 1, 1]);

    // Mismo proceso: Entregado cierra y cuenta. Son independientes: vence el original y la copia sigue.
    assert.equal((await t.api("POST", `/api/orders/${order.id}/finish`)).status, 200);
    assert.equal(t.jobs().find((j) => j.document_id === copy.id).status, "printed");
    t.ctx.db.run("UPDATE orders SET finished_at = ? WHERE id = ?", new Date(Date.now() - 31 * DAY).toISOString(), orderId);
    t.ctx.db.run("UPDATE print_jobs SET sent_at = ? WHERE order_id = ?", new Date(Date.now() - 31 * DAY).toISOString(), orderId);
    assert.equal((await t.ctx.retention.run()).deleted, 1);
    assert.equal(t.docs()[0].status, "deleted");
    assert.equal((await t.api("GET", `/api/documents/${copy.id}/pdf`)).status, 200, "la copia no depende del original");
    // La corrección sin cobro sigue funcionando igual, dentro del mismo pedido.
    const free = await t.api("POST", `/api/documents/${copy.id}/reprint`, {});
    assert.equal(free.status, 200);
    assert.equal(t.ctx.db.all("SELECT * FROM orders").length, 2);
  } finally {
    await t.close();
  }
});

test("retención de 30 días: solo pedidos cerrados y vencidos; se conservan metadatos y excepciones", async () => {
  const t = await makeAgent();
  try {
    const old = await seed(t, { customer: "Vencido", files: [["carta"], ["legal"]] });
    const recent = await seed(t, { customer: "Reciente" });
    const kept = await seed(t, { customer: "Excepción" });
    const open = await seed(t, { customer: "Pendiente" });
    const active = await seed(t, { customer: "Con impresión activa" });
    const discarded = await seed(t, { customer: "Descartado" });
    for (const o of [old, recent, kept, active]) assert.equal((await t.api("POST", `/api/orders/${o.orderId}/finish`)).status, 200);
    await t.api("POST", `/api/orders/${kept.orderId}/update`, { keep_documents: true });
    await t.api("POST", "/api/documents/discard", { ids: discarded.ids });

    const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
    const setFinished = (id, d) => t.ctx.db.run("UPDATE orders SET finished_at = ? WHERE id = ?", ago(d), id);
    setFinished(old.orderId, 31);
    setFinished(recent.orderId, 29);
    setFinished(kept.orderId, 90);
    setFinished(active.orderId, 40);
    t.ctx.db.run("UPDATE orders SET created_at = ? WHERE id = ?", ago(200), open.orderId);
    t.ctx.db.run("UPDATE documents SET discarded_at = ? WHERE id = ?", ago(31), discarded.ids[0]);
    // Reimpresión en curso sobre un pedido ya vencido.
    t.printerService.offline.add("HP Carta");
    await t.api("POST", `/api/documents/${active.ids[0]}/reprint`, {});

    const result = await t.ctx.retention.run();
    assert.equal(result.deleted, 3, "dos del pedido vencido + el descartado");
    const status = (id) => t.docs().find((d) => d.id === id).status;
    assert.deepEqual(old.ids.map(status), ["deleted", "deleted"]);
    assert.equal(status(discarded.ids[0]), "deleted");
    for (const o of [recent, kept, open, active]) assert.equal(status(o.ids[0]), "ready", "no debía eliminarse");
    for (const id of old.ids) {
      for (const root of ["Originales", "PDF", "Completados", "Errores"]) assert.equal(existsSync(join(t.dir, root, id)), false);
    }
    assert.ok(existsSync(join(t.dir, "Completados", recent.ids[0])), "los archivos de otros pedidos siguen intactos");
    assert.ok(existsSync(join(t.dir, "Originales", open.ids[0])));

    // Metadatos y registro de eliminación se conservan.
    const doc = t.docs().find((d) => d.id === old.ids[0]);
    assert.deepEqual([doc.original_name, doc.page_count, doc.original_file], ["doc-0.pdf", 1, null]);
    const dels = (await t.api("GET", "/api/history/deletions")).body.deletions;
    assert.equal(dels.length, 3);
    assert.match(dels.find((d) => d.document_id === old.ids[0]).reason, /Retención de 30 días/);
    assert.ok(t.ctx.db.get("SELECT documents_deleted_at FROM orders WHERE id = ?", old.orderId).documents_deleted_at);

    // El plazo es configurable.
    t.ctx.store.setSetting("retention_days", "20");
    assert.equal((await t.ctx.retention.run()).deleted, 1);
    assert.equal(status(recent.ids[0]), "deleted");
    // Segunda pasada: no repite ni borra de más.
    assert.equal((await t.ctx.retention.run()).deleted, 0);
  } finally {
    await t.close();
  }
});
