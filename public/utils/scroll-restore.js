








//







//



//

// Modul-Roots (.budget-page, .calendar-page, .contacts-page, .meals-page,
// .notes-page, .pantry-page, .recipes-page, .shopping-page) sind `overflow:




//




//






const positions = new Map();

export function rememberScrollPosition(path, top) {
  if (typeof path !== 'string' || !path) return;
  const value = Number(top);


  if (!Number.isFinite(value) || value <= 0) {
    positions.delete(path);
    return;
  }
  positions.set(path, value);
}

export function scrollPositionFor(path, { restore = false } = {}) {
  if (!restore) return 0;
  return positions.get(path) ?? 0;
}

/** Verwirft alle gemerkten Positionen (Sitzungsende, Tests). */
export function forgetScrollPositions() {
  positions.clear();
}
