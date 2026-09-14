
const FALLBACK_CATEGORY = 'Sonstiges';



const KEYWORDS = {
  'Obst & Gemüse': [
    'apple', 'apfel', 'banana', 'banane', 'tomato', 'tomate', 'onion', 'zwiebel',
    'garlic', 'knoblauch', 'potato', 'kartoffel', 'carrot', 'karotte', 'lemon',
    'zitrone', 'lime', 'pepper', 'paprika', 'lettuce', 'salat', 'spinach', 'spinat',
    'cucumber', 'gurke', 'vegetable', 'gemüse', 'fruit', 'obst', 'herb', 'kräuter',
    'basil', 'basilikum', 'parsley', 'petersilie', 'mushroom', 'pilz',
  ],
  'Backwaren': [
    'flour', 'mehl', 'bread', 'brot', 'baking powder', 'backpulver', 'yeast',
    'hefe', 'bun', 'brötchen', 'tortilla', 'noodle', 'nudel', 'pasta',
  ],
  'Milchprodukte': [
    'milk', 'milch', 'cheese', 'käse', 'butter', 'cream', 'sahne', 'yogurt',
    'joghurt', 'egg', 'ei', 'eier',
  ],
  'Fleisch & Fisch': [
    'chicken', 'hähnchen', 'huhn', 'beef', 'rind', 'pork', 'schwein', 'fish',
    'fisch', 'salmon', 'lachs', 'shrimp', 'garnele', 'bacon', 'speck', 'sausage',
    'wurst', 'meat', 'fleisch',
  ],
  'Tiefkühl': ['frozen', 'tiefkühl', 'tiefgefroren', 'ice cream', 'eis'],
  'Getränke': ['juice', 'saft', 'wine', 'wein', 'beer', 'bier', 'water', 'wasser', 'soda', 'cola'],
  'Haushalt': ['foil', 'folie', 'napkin', 'serviette', 'detergent', 'waschmittel'],
  'Drogerie': ['soap', 'seife', 'shampoo', 'toothpaste', 'zahnpasta'],
};

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Wortgrenzen statt reinem .includes(): sonst matcht das kurze Stichwort 'ei'
// (Ei/Eier) versehentlich mitten in 'Fleisch' ('fl-ei-sch'). \p{L}/\p{N} statt

function containsWord(text, keyword) {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(keyword)}(?![\\p{L}\\p{N}])`, 'iu');
  return pattern.test(text);
}

function matchKeywords(text) {
  if (!text) return null;
  for (const [category, keywords] of Object.entries(KEYWORDS)) {
    if (keywords.some((kw) => containsWord(text, kw))) return category;
  }
  return null;
}

export function categorizeIngredient({ labelName, foodName } = {}) {
  return matchKeywords(labelName) || matchKeywords(foodName) || FALLBACK_CATEGORY;
}
