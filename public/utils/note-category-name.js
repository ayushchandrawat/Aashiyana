export const NOTE_CATEGORY_NAME_MAX_LENGTH = 80;

export function categoryNameKey(name) {
  return String(name)
    .normalize('NFKC')
    .toUpperCase().toLowerCase()
    .toUpperCase().toLowerCase()
    .normalize('NFKC');
}
