import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { analyzePdf, validateFileFormat } from "../src/analyzer.js";
import { classifySize, findDriverForm } from "../src/paper.js";
import { planDocument, resolvePrinter, ruleMatches } from "../src/planner.js";
import { makePdf, PRINTERS, RULES } from "./helpers.js";

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), "fqp-an-")); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

const write = async (name, content) => {
  const p = join(dir, name);
  await writeFile(p, content);
  return p;
};

test("clasificación de tamaños: carta, A4, oficio II, legal y personalizado", () => {
  assert.equal(classifySize(612, 792), "carta");
  assert.equal(classifySize(792, 612), "carta", "apaisado sigue siendo carta");
  assert.equal(classifySize(595.28, 841.89), "a4");
  assert.equal(classifySize(612, 936), "oficio2");
  assert.equal(classifySize(612, 1008), "legal");
  assert.equal(classifySize(400, 600), "custom");
});

test("oficio II no se confunde con legal ni carta con A4, incluso con tolerancia", () => {
  assert.equal(classifySize(612, 940, 8), "oficio2");
  assert.equal(classifySize(612, 1003, 8), "legal");
  assert.equal(classifySize(612, 970, 8), "custom", "entre oficio II y legal no pertenece a ninguno");
  assert.equal(classifySize(600, 800, 8), "custom", "entre carta y A4 no pertenece a ninguno");
  assert.equal(classifySize(612, 936, 80), "oficio2", "con tolerancia exagerada gana el más cercano");
  assert.equal(classifySize(612, 1008, 80), "legal");
});

test("formulario del driver se busca por dimensiones, no por nombre", () => {
  const forms = [{ name: "Carta", w: 850, h: 1100 }, { name: "Folio 8.5x13", w: 850, h: 1300 }, { name: "Oficio", w: 850, h: 1400 }];
  assert.equal(findDriverForm("oficio2", forms), "Folio 8.5x13");
  assert.equal(findDriverForm("legal", forms), "Oficio");
  assert.equal(findDriverForm("a4", forms), null, "si el driver no lo tiene, no se inventa");
});

for (const [size, label] of [["carta", "carta"], ["a4", "A4"], ["oficio2", "oficio II"], ["legal", "legal"]]) {
  test(`análisis de PDF: detección de ${label}`, async () => {
    const a = await analyzePdf(await write(`${size}.pdf`, await makePdf([size, size, size])));
    assert.equal(a.pageCount, 3);
    assert.equal(a.sizeClass, size);
    assert.equal(a.orientation, "portrait");
    assert.equal(a.groups.length, 1);
    assert.equal(a.groups[0].ranges, "1-3");
  });
}

test("análisis de PDF: páginas mixtas con rangos por tamaño", async () => {
  const a = await analyzePdf(await write("mixto.pdf", await makePdf(["carta", "carta", "legal", "carta", "oficio2"])));
  assert.equal(a.sizeClass, "mixed");
  assert.equal(a.pageCount, 5);
  const by = Object.fromEntries(a.groups.map((g) => [g.cls, g]));
  assert.equal(by.carta.ranges, "1-2,4");
  assert.equal(by.legal.ranges, "3");
  assert.equal(by.oficio2.ranges, "5");
});

test("análisis de PDF: tamaño personalizado y orientación apaisada", async () => {
  const a = await analyzePdf(await write("custom.pdf", await makePdf([[800, 500]])));
  assert.equal(a.sizeClass, "custom");
  assert.equal(a.orientation, "landscape");
});

test("validación: PDF dañado, archivo que no es PDF y archivo vacío", async () => {
  await assert.rejects(analyzePdf(await write("roto.pdf", "%PDF-1.7\nesto no es un pdf de verdad")), { code: "PDF_CORRUPT" });
  await assert.rejects(analyzePdf(await write("falso.pdf", "hola mundo")), { code: "INVALID_FORMAT" });
  await assert.rejects(validateFileFormat(await write("vacio.pdf", ""), ".pdf"), { code: "EMPTY" });
});

test("validación: DOCX protegido con contraseña y DOCX inválido", async () => {
  const ole = Buffer.from("d0cf11e0a1b11ae1000000000000", "hex");
  await assert.rejects(validateFileFormat(await write("clave.docx", ole), ".docx"), { code: "PASSWORD" });
  await assert.rejects(validateFileFormat(await write("basura.docx", "no soy un zip"), ".docx"), { code: "INVALID_FORMAT" });
  await validateFileFormat(await write("ok.docx", Buffer.from("504b0304deadbeef", "hex")), ".docx");
  await validateFileFormat(await write("ok.doc", ole), ".doc");
});

// ── Motor de reglas ──────────────────────────────────────────

const env = (over = {}) => ({ printers: Object.values(PRINTERS), rules: RULES, isAvailable: () => true, ...over });
const docWith = (over = {}) => ({
  status: "ready", order_id: "o1", copies: 1, color_mode: "bw", duplex: "simplex",
  analysis: { sizeClass: "carta", pageCount: 2, groups: [{ cls: "carta", ranges: "1-2", count: 2 }] }, ...over,
});

test("reglas: carta B/N, legal B/N, carta color y dúplex van a la impresora correcta", () => {
  const pick = (part) => resolvePrinter({ pageCount: 1, ...part }, env()).printer?.name;
  assert.equal(pick({ paper: "carta", colorMode: "bw", duplex: "simplex" }), "Láser Carta");
  assert.equal(pick({ paper: "legal", colorMode: "bw", duplex: "simplex" }), "Láser Legal");
  assert.equal(pick({ paper: "oficio2", colorMode: "bw", duplex: "simplex" }), "Láser Legal");
  assert.equal(pick({ paper: "carta", colorMode: "color", duplex: "simplex" }), "Tinta Color");
  assert.equal(pick({ paper: "carta", colorMode: "bw", duplex: "long" }), "Láser Carta");
});

test("reglas: sin coincidencia o sin capacidad declarada se pide intervención manual", () => {
  const r1 = resolvePrinter({ paper: "legal", colorMode: "color", duplex: "simplex", pageCount: 1 }, env());
  assert.match(r1.problem, /seleccione la impresora manualmente/);
  // Legal en dúplex: la regla coincide pero la impresora no declara dúplex.
  const r2 = resolvePrinter({ paper: "legal", colorMode: "bw", duplex: "long", pageCount: 1 }, env());
  assert.ok(r2.problem);
  // Selección manual incompatible: se rechaza con el motivo.
  const r3 = resolvePrinter({ paper: "carta", colorMode: "color", duplex: "simplex", pageCount: 1 }, env({ manualPrinterId: PRINTERS.carta.id }));
  assert.match(r3.problem, /no imprime a color/);
});

test("reglas: prioridad, regla deshabilitada y límites de páginas", () => {
  const extra = { ...RULES[0], id: "x", name: "Carta grande", priority: 1, min_pages: 50, printer_id: PRINTERS.color.id };
  const small = resolvePrinter({ paper: "carta", colorMode: "bw", duplex: "simplex", pageCount: 3 }, env({ rules: [...RULES, extra] }));
  const big = resolvePrinter({ paper: "carta", colorMode: "bw", duplex: "simplex", pageCount: 80 }, env({ rules: [...RULES, extra] }));
  assert.equal(small.printer.name, "Láser Carta");
  assert.equal(big.printer.name, "Tinta Color");
  assert.equal(ruleMatches({ ...RULES[0], enabled: false }, { paper: "carta", colorMode: "bw", duplex: "simplex", pageCount: 1 }), false);
});

test("reglas: impresora apagada → se usa otra regla compatible o se informa no disponible", () => {
  const backup = { ...RULES[0], id: "y", name: "Carta respaldo", priority: 99, printer_id: PRINTERS.color.id };
  const isAvailable = (p) => p.id !== PRINTERS.carta.id;
  const withBackup = resolvePrinter({ paper: "carta", colorMode: "bw", duplex: "simplex", pageCount: 1 }, env({ rules: [...RULES, backup], isAvailable }));
  assert.equal(withBackup.printer.name, "Tinta Color");
  const alone = resolvePrinter({ paper: "carta", colorMode: "bw", duplex: "simplex", pageCount: 1 }, env({ isAvailable }));
  assert.equal(alone.printer.name, "Láser Carta");
  assert.equal(alone.available, false);
});

test("plan: instrucciones incompletas impiden autorizar", () => {
  const plan = planDocument(docWith({ order_id: null, copies: null, color_mode: null, duplex: null }), env());
  assert.equal(plan.ok, false);
  assert.equal(plan.problems.length, 4);
});

test("plan: nunca escala sin una regla explícita", () => {
  const sinRegla = planDocument(docWith({ paper_size: "legal" }), env());
  assert.equal(sinRegla.ok, false);
  assert.match(sinRegla.problems.join(" "), /regla de ajuste/);
  const conRegla = planDocument(docWith({ paper_size: "legal", scale_mode: "fit" }), env());
  assert.equal(conRegla.ok, true);
  assert.deepEqual([conRegla.parts[0].paper, conRegla.parts[0].scale], ["legal", "fit"]);
  assert.equal(planDocument(docWith(), env()).parts[0].scale, "noscale");
});

test("plan: páginas mixtas → revisión, separación por tamaño o ajuste", () => {
  const analysis = { sizeClass: "mixed", pageCount: 3, groups: [{ cls: "carta", ranges: "1-2", count: 2 }, { cls: "legal", ranges: "3", count: 1 }] };
  const revision = planDocument(docWith({ analysis }), env());
  assert.equal(revision.ok, false);
  const split = planDocument(docWith({ analysis, mixed_strategy: "split" }), env());
  assert.equal(split.ok, true);
  assert.deepEqual(split.parts.map((p) => [p.paper, p.pages, p.printerName]), [["carta", "1-2", "Láser Carta"], ["legal", "3", "Láser Legal"]]);
  const fit = planDocument(docWith({ analysis, mixed_strategy: "fit", paper_size: "carta" }), env());
  assert.deepEqual([fit.parts.length, fit.parts[0].scale, fit.parts[0].pages], [1, "fit", null]);
});
