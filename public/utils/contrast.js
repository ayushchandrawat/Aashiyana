

function relativeLuminance(r, g, b) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function parseHex(value) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const hex = match[1].length === 3
    ? match[1].split('').map((c) => c + c).join('')
    : match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

export function contrastRatio(hexA, hexB) {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return null;
  const la = relativeLuminance(...a);
  const lb = relativeLuminance(...b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}






const ON_ACCENT = '#ffffff';
const INK_ON_BRIGHT = '#000000';




const AA_TEXT = 4.5;

export function prefersInkText(background) {
  const onWhite = contrastRatio(background, ON_ACCENT);
  if (onWhite == null || onWhite >= AA_TEXT) return false;
  return contrastRatio(background, INK_ON_BRIGHT) > onWhite;
}
