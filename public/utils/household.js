
let _size = null;

export function setHouseholdSize(size) {
  if (!Number.isFinite(size) || size < 1) return;
  _size = size;
  document.documentElement.classList.toggle('household-solo', size === 1);
}

export function clearHouseholdSize() {
  _size = null;
  document.documentElement.classList.remove('household-solo');
}

export function isSoloHousehold() {
  return _size === 1;
}

export function getHouseholdSize() {
  return _size;
}
