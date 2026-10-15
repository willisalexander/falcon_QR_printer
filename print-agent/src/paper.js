/**
 * Tamaños de papel. Dimensiones en puntos PostScript (1/72 in), lado corto × lado largo.
 * Oficio II (8.5 × 13 in) y Legal (8.5 × 14 in) son tamaños distintos.
 */
export const PAPER_SIZES = {
  carta:   { label: "Carta",     w: 612,    h: 792,    inches: "8.5 × 11 in" },
  a4:      { label: "A4",        w: 595.28, h: 841.89, inches: "210 × 297 mm" },
  oficio2: { label: "Oficio II", w: 612,    h: 936,    inches: "8.5 × 13 in" },
  legal:   { label: "Legal",     w: 612,    h: 1008,   inches: "8.5 × 14 in" },
};

export const PAPER_KEYS = Object.keys(PAPER_SIZES);

/** Clasifica una página por sus dimensiones reales. Devuelve clave o "custom". */
export function classifySize(widthPt, heightPt, tolerancePt = 8) {
  const w = Math.min(widthPt, heightPt);
  const h = Math.max(widthPt, heightPt);
  let best = null;
  for (const [key, s] of Object.entries(PAPER_SIZES)) {
    const dw = Math.abs(w - s.w);
    const dh = Math.abs(h - s.h);
    if (dw <= tolerancePt && dh <= tolerancePt) {
      const dist = dw + dh;
      if (!best || dist < best.dist) best = { key, dist };
    }
  }
  return best ? best.key : "custom";
}

/**
 * Busca en los formularios que reporta el driver (centésimas de pulgada) el que
 * corresponde al tamaño pedido. Devuelve el nombre exacto del driver o null.
 */
export function findDriverForm(paperKey, driverSizes, toleranceHundredths = 4) {
  const s = PAPER_SIZES[paperKey];
  if (!s || !Array.isArray(driverSizes)) return null;
  const w = (s.w / 72) * 100;
  const h = (s.h / 72) * 100;
  let best = null;
  for (const f of driverSizes) {
    const fw = Math.min(f.w, f.h);
    const fh = Math.max(f.w, f.h);
    const dist = Math.abs(fw - w) + Math.abs(fh - h);
    if (Math.abs(fw - w) <= toleranceHundredths && Math.abs(fh - h) <= toleranceHundredths) {
      if (!best || dist < best.dist) best = { name: f.name, dist };
    }
  }
  return best ? best.name : null;
}
