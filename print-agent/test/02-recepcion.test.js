import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { makeAgent, makePdf, sleep, waitFor } from "./helpers.js";

test("crea la estructura de carpetas y detecta un PDF sin intervención", async () => {
  const t = await makeAgent();
  try {
    for (const d of ["Entradas", "Procesando", "Originales", "PDF", "Completados", "Errores", "Logs", "Temporales"]) {
      assert.ok(existsSync(join(t.dir, d)), `falta la carpeta ${d}`);
    }
    const before = t.ctx.bus.version;
    await t.drop("tarea.pdf", await makePdf(["carta"]));
    await t.waitReady(1);
    const [doc] = t.docs();
    assert.equal(doc.original_name, "tarea.pdf");
    assert.equal(doc.page_count, 1);
    assert.equal(doc.size_class, "carta");
    assert.match(doc.sha256, /^[0-9a-f]{64}$/);
    assert.ok(doc.received_at);
    assert.ok(t.ctx.bus.version > before, "el panel recibe aviso de cambio sin recargar");
    // El archivo salió de Entradas y quedó guardado por identificador, no por nombre.
    assert.deepEqual(await readdir(t.entradas), []);
    assert.ok(existsSync(join(t.dir, "Originales", doc.id, "original.pdf")));
    // Aparecer en la carpeta nunca imprime.
    assert.equal(t.jobs().length, 0);
    assert.equal(t.printDriver.calls.length, 0);
  } finally {
    await t.close();
  }
});

test("descarga incompleta: no se toma hasta que deja de crecer; los temporales se ignoran", async () => {
  const t = await makeAgent({ settings: { file_stability_ms: "600" } });
  try {
    const pdf = await makePdf(["carta", "carta"]);
    const half = Math.floor(pdf.length / 2);
    const path = join(t.entradas, "grande.pdf");
    await writeFile(path, pdf.subarray(0, half));
    await writeFile(join(t.entradas, "otro.pdf.crdownload"), "parcial");
    await writeFile(join(t.entradas, "~$temporal.docx"), "bloqueo de Word");
    // Sigue llegando en trozos, cada uno antes de que venza el periodo de estabilidad.
    for (let i = 0; i < 4; i++) {
      await sleep(250);
      assert.equal(t.docs().length, 0, "se tomó un archivo que aún se estaba escribiendo");
      const upTo = i === 3 ? pdf.length : half + (i + 1) * 10;
      await appendFile(path, pdf.subarray(half + i * 10, upTo));
    }
    await t.waitReady(1);
    const [doc] = t.docs();
    assert.equal(doc.size_bytes, pdf.length, "se registró el archivo completo");
    assert.equal(doc.page_count, 2);
    assert.equal(t.docs().length, 1, "los temporales no se registran");
    // Cuando el navegador termina y renombra el .crdownload, entonces sí entra.
    await writeFile(join(t.entradas, "otro.pdf.crdownload"), pdf);
    await rename(join(t.entradas, "otro.pdf.crdownload"), join(t.entradas, "otro.pdf"));
    await t.waitReady(2);
  } finally {
    await t.close();
  }
});

test("archivos con el mismo nombre no se sobrescriben; mismo contenido queda marcado", async () => {
  const t = await makeAgent();
  try {
    const a = await makePdf(["carta"]);
    const b = await makePdf(["legal", "legal"]);
    await t.drop("documento.pdf", a);
    await t.waitReady(1);
    await t.drop("documento.pdf", b);
    await t.waitReady(2);
    await t.drop("documento.pdf", a);
    await t.waitReady(3);
    const docs = t.docs();
    assert.equal(new Set(docs.map((d) => d.id)).size, 3);
    assert.deepEqual(docs.map((d) => d.size_class), ["carta", "legal", "carta"]);
    for (const d of docs) {
      const stored = await readFile(join(t.dir, "Originales", d.id, "original.pdf"));
      assert.equal(stored.length, d.size_bytes);
    }
    assert.equal(docs[1].duplicate_of, null);
    assert.equal(docs[2].duplicate_of, docs[0].id, "el contenido repetido se avisa, no se descarta");
  } finally {
    await t.close();
  }
});

test("quince archivos en un minuto: sin pérdida ni duplicación", async () => {
  const t = await makeAgent();
  try {
    const sizes = ["carta", "legal", "oficio2", "a4"];
    const t0 = Date.now();
    for (let i = 0; i < 15; i++) {
      const name = i % 3 === 0 ? `informe-${i}.docx` : `archivo-${i}.pdf`;
      const content = name.endsWith(".docx")
        ? Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.from(`docx ${i}`)])
        : await makePdf(Array(1 + (i % 3)).fill(sizes[i % 4]));
      await t.drop(name, content);
      await sleep(60);
    }
    await t.waitReady(15);
    const docs = t.docs();
    assert.equal(docs.length, 15);
    assert.equal(new Set(docs.map((d) => d.original_name)).size, 15);
    assert.equal(new Set(docs.map((d) => d.id)).size, 15);
    assert.deepEqual(await readdir(t.entradas), []);
    assert.equal(t.converter.calls, 5, "cada Word se convirtió exactamente una vez");
    const m = t.ctx.orders.metrics();
    assert.equal(m.received, 15);
    console.log(`    15 archivos recibidos y listos en ${Date.now() - t0} ms (conversión promedio ${Math.round(m.avg_convert_ms)} ms)`);
  } finally {
    await t.close();
  }
});

test("tipos no admitidos se dejan en la carpeta y se informan; archivo demasiado grande va a Errores", async () => {
  const t = await makeAgent({ settings: { local_max_file_size_mb: "1" } });
  try {
    await t.drop("foto.jpg", "jpeg");
    await t.drop("enorme.pdf", Buffer.concat([await makePdf(["carta"]), Buffer.alloc(1100 * 1024)]));
    await waitFor(() => t.docs().some((d) => d.status === "error"));
    const [doc] = t.docs();
    assert.equal(doc.error_code, "TOO_LARGE");
    assert.ok(existsSync(join(t.dir, "Errores", doc.id, "original.pdf")));
    assert.ok(existsSync(join(t.entradas, "foto.jpg")), "no se toca lo que no se admite");
    assert.equal(t.ctx.intake.status().ignored[0].name, "foto.jpg");
  } finally {
    await t.close();
  }
});

test("reinicio del agente: detecta lo que llegó apagado y retoma lo que quedó a medias", async () => {
  const t1 = await makeAgent();
  await t1.drop("antes.pdf", await makePdf(["carta"]));
  await t1.waitReady(1);
  await t1.close({ keep: true });

  // Con el agente apagado: llega un archivo, queda otro a medio recibir y otro a media conversión.
  await writeFile(join(t1.dir, "Entradas", "apagado.pdf"), await makePdf(["legal"]));
  const t2 = await makeAgent({ baseDir: t1.dir, start: false });
  const stagedId = "99999999-9999-4999-8999-999999999999";
  const convId = "88888888-8888-4888-8888-888888888888";
  const now = new Date().toISOString();
  await writeFile(join(t1.dir, "Procesando", `${stagedId}.pdf`), await makePdf(["oficio2"]));
  t2.ctx.db.run("INSERT INTO documents (id, original_name, ext, received_at, status, updated_at) VALUES (?, 'a-medias.pdf', '.pdf', ?, 'intake', ?)", stagedId, now, now);
  await mkdir(join(t1.dir, "Originales", convId), { recursive: true });
  await writeFile(join(t1.dir, "Originales", convId, "original.pdf"), await makePdf(["a4"]));
  t2.ctx.db.run("INSERT INTO documents (id, original_name, ext, received_at, status, original_file, updated_at) VALUES (?, 'convirtiendo.pdf', '.pdf', ?, 'converting', ?, ?)",
    convId, now, `Originales/${convId}/original.pdf`, now);
  await t2.agent.start();
  try {
    await t2.waitReady(4);
    const by = Object.fromEntries(t2.docs().map((d) => [d.original_name, d.size_class]));
    assert.deepEqual(by, { "antes.pdf": "carta", "apagado.pdf": "legal", "a-medias.pdf": "oficio2", "convirtiendo.pdf": "a4" });
    assert.equal(t2.docs().length, 4, "nada se duplicó al reiniciar");
    assert.deepEqual(await readdir(join(t1.dir, "Procesando")), []);
  } finally {
    await t2.close();
  }
});

test("conversión Word: éxito, fallo con reintento y conservación del original", async () => {
  const t = await makeAgent();
  try {
    const docx = Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.from("contenido")]);
    t.converter.fail = true;
    await t.drop("carta-poder.docx", docx);
    await waitFor(() => t.docs()[0]?.status === "error");
    let [doc] = t.docs();
    assert.equal(doc.error_code, "CONVERT_FAILED");
    assert.ok(existsSync(join(t.dir, "Errores", doc.id, "original.docx")), "el original se conserva en Errores");
    assert.equal((await t.api("POST", "/api/documents/authorize", { ids: [doc.id] })).body.results[0].ok, false, "un documento sin validar no se imprime");

    t.converter.fail = false;
    assert.equal((await t.api("POST", `/api/documents/${doc.id}/retry`)).status, 200);
    await t.waitReady(1);
    [doc] = t.docs();
    assert.equal(doc.page_count, 2);
    assert.equal(doc.convert_attempts, 2);
    assert.ok(existsSync(join(t.dir, "Originales", doc.id, "original.docx")), "el Word original se conserva");
    assert.ok(existsSync(join(t.dir, "PDF", doc.id, "document.pdf")));
    // Vista previa del PDF resultante por identificador.
    const pdf = await t.api("GET", `/api/documents/${doc.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  } finally {
    await t.close();
  }
});
