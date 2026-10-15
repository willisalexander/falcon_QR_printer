/**
 * Motor de reglas de asignación de impresora y planificación de un documento.
 * Funciones puras: reciben impresoras y reglas ya configuradas en el panel.
 * Nunca se asume una capacidad que no esté declarada en la configuración.
 */
import { PAPER_SIZES } from "./paper.js";

export const COLOR_MODES = ["bw", "color"];
export const DUPLEX_MODES = ["simplex", "long", "short"];
export const SCALE_MODES = ["noscale", "fit", "shrink"];

/** ¿La impresora, según su configuración, puede con este trabajo? */
export function printerSupports(printer, { paper, colorMode, duplex }) {
  if (!printer.is_active) return "está deshabilitada";
  if (!printer.paper_sizes.includes(paper)) return `no tiene configurado el tamaño ${PAPER_SIZES[paper]?.label ?? paper}`;
  if (colorMode === "color" && !printer.supports_color) return "no imprime a color";
  if (duplex !== "simplex" && !printer.supports_duplex) return "no tiene dúplex";
  return null;
}

export function ruleMatches(rule, { paper, colorMode, duplex, pageCount }) {
  if (!rule.enabled) return false;
  if (rule.paper_size !== "any" && rule.paper_size !== paper) return false;
  if (rule.color_mode !== "any" && rule.color_mode !== colorMode) return false;
  if (rule.duplex === "yes" && duplex === "simplex") return false;
  if (rule.duplex === "no" && duplex !== "simplex") return false;
  if (rule.min_pages != null && pageCount < rule.min_pages) return false;
  if (rule.max_pages != null && pageCount > rule.max_pages) return false;
  return true;
}

/**
 * Elige impresora para una parte del trabajo.
 * @returns {{printer?:object, rule?:object, tray?:string|null, available?:boolean, problem?:string}}
 */
export function resolvePrinter(part, { printers, rules, manualPrinterId, isAvailable }) {
  if (manualPrinterId) {
    const printer = printers.find((p) => p.id === manualPrinterId);
    if (!printer) return { problem: "La impresora seleccionada ya no existe en la configuración." };
    const why = printerSupports(printer, part);
    if (why) return { problem: `${printer.name} ${why}.` };
    return { printer, rule: null, tray: printer.trays[part.paper] ?? null, available: isAvailable(printer) };
  }

  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  let fallback = null;
  for (const rule of sorted) {
    if (!ruleMatches(rule, part)) continue;
    const printer = printers.find((p) => p.id === rule.printer_id);
    if (!printer || printerSupports(printer, part)) continue;
    const hit = { printer, rule, tray: rule.tray || printer.trays[part.paper] || null };
    if (isAvailable(printer)) return { ...hit, available: true };
    fallback ??= { ...hit, available: false }; // coincide pero está apagada: buscar otra regla
  }
  if (fallback) return fallback;
  return { problem: "Ninguna regla de impresión coincide: seleccione la impresora manualmente." };
}

/**
 * Decide cómo se imprimiría un documento con su configuración actual.
 * `problems` impide autorizar; `warnings` solo impide el modo automático.
 */
export function planDocument(doc, env) {
  const problems = [];
  const warnings = [];
  const parts = [];

  if (doc.status !== "ready") {
    return { ok: false, problems: ["El documento todavía no está validado."], warnings, parts };
  }
  if (!env.skipOrderCheck && !doc.order_id) problems.push("Falta identificar al cliente.");
  if (!Number.isInteger(doc.copies) || doc.copies < 1) problems.push("Falta la cantidad de copias.");
  if (!COLOR_MODES.includes(doc.color_mode)) problems.push("Falta indicar blanco y negro o color.");
  if (!DUPLEX_MODES.includes(doc.duplex)) problems.push("Falta indicar simple o dúplex.");

  const analysis = doc.analysis;
  if (!analysis) return { ok: false, problems: ["Documento sin análisis."], warnings, parts };

  const sized = [];
  if (analysis.sizeClass === "mixed") {
    if (doc.mixed_strategy === "split") {
      for (const g of analysis.groups) {
        if (g.cls === "custom") {
          problems.push(`Páginas ${g.ranges} con tamaño personalizado: use "Ajustar a un tamaño".`);
        } else {
          sized.push({ paper: g.cls, pages: g.ranges, pageCount: g.count, scale: "noscale" });
        }
      }
    } else if (doc.mixed_strategy === "fit") {
      if (!PAPER_SIZES[doc.paper_size]) problems.push("Elija el tamaño de papel al que se ajustarán todas las páginas.");
      else sized.push({ paper: doc.paper_size, pages: null, pageCount: analysis.pageCount, scale: doc.scale_mode === "shrink" ? "shrink" : "fit" });
    } else {
      problems.push("Páginas de tamaños distintos: elija separar por tamaño o ajustar a un solo tamaño.");
    }
  } else {
    const detected = analysis.sizeClass;
    const target = PAPER_SIZES[doc.paper_size] ? doc.paper_size : detected !== "custom" ? detected : null;
    if (!target) {
      problems.push("Tamaño personalizado: elija el papel y la regla de ajuste.");
    } else if (target !== detected) {
      // Nunca se escala por cuenta propia: el operador debe elegir la regla.
      if (doc.scale_mode === "fit" || doc.scale_mode === "shrink") {
        sized.push({ paper: target, pages: null, pageCount: analysis.pageCount, scale: doc.scale_mode });
      } else {
        problems.push("El papel elegido no coincide con el tamaño del documento: elija la regla de ajuste.");
      }
    } else {
      sized.push({ paper: target, pages: null, pageCount: analysis.pageCount, scale: "noscale" });
    }
  }

  if (analysis.encrypted) warnings.push("PDF con restricciones de seguridad: revise la vista previa.");
  if (doc.duplicate_of) warnings.push("Mismo contenido que un documento recibido antes.");

  if (COLOR_MODES.includes(doc.color_mode) && DUPLEX_MODES.includes(doc.duplex)) {
    for (const s of sized) {
      const part = { ...s, colorMode: doc.color_mode, duplex: doc.duplex };
      const r = resolvePrinter(part, { ...env, manualPrinterId: doc.printer_id });
      if (r.problem) {
        problems.push(r.problem);
        continue;
      }
      parts.push({
        ...s,
        printerId: r.printer.id, printerName: r.printer.name, printerSystemName: r.printer.system_name,
        tray: r.tray, ruleId: r.rule?.id ?? null, ruleName: r.rule?.name ?? null, available: r.available,
      });
    }
  }

  const ok = problems.length === 0 && parts.length > 0;
  return {
    ok, problems, warnings, parts,
    allAvailable: ok && parts.every((p) => p.available),
    autoBlocked: warnings.length > 0 && !doc.review_ack,
  };
}
