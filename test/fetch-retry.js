
const TRANSIENT = new Set([
  'EADDRNOTAVAIL', // kein freier ephemerer Port (der gemessene Fall)
  'EADDRINUSE',    // Portvergabe kollidiert unter Last
  'EMFILE',        // Dateideskriptoren des Prozesses erschoepft
  'ENFILE',        // dieselbe Grenze systemweit
  'ENOBUFS',       // Kernel-Puffer voll
  'EAGAIN',        // Ressource momentan nicht verfuegbar
  'ECONNRESET',    // Accept-Backlog uebergelaufen, RST statt Antwort
  'ETIMEDOUT',
]);

function istVoruebergehend(err) {

  // (Happy Eyeballs) tragen ihn eine Ebene tiefer.
  const codes = [err?.code, err?.cause?.code, ...(err?.cause?.errors || []).map((e) => e?.code)];
  return codes.some((code) => code && TRANSIENT.has(code));
}

export async function fetchRetry(url, options, { versuche = 4 } = {}) {
  let letzter;
  for (let versuch = 1; versuch <= versuche; versuch++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (!istVoruebergehend(err) || versuch === versuche) throw err;
      letzter = err;


      await new Promise((r) => setTimeout(r, 25 * 2 ** (versuch - 1)));
    }
  }
  throw letzter;
}
