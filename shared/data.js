// Shared game data used by both the authoritative server and the browser client.
// Everything that defines "what exists" in Supermarket lives here.

export const TICK_RATE = 20;              // server simulation ticks per second
export const REAL_SECONDS_PER_MINUTE = 0.4; // 1 in-game minute at 1x speed
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 22;
export const LAST_ENTRY_HOUR = 21.5;
export const STARTING_CASH = 400;
export const MAX_CUSTOMERS = 15;       // never more than this many shoppers at once (no queue outside)
export const FLOOR_H = 3.6;            // height of one storey
export const STARTER_PRODUCTS = ['flour', 'oil', 'sugar']; // licensed from day one
export const MAX_PLAYERS = 4;
export const OUTSIDE_ROWS = 5;            // walkable rows in front of the store (wall row + 4)

export const CATEGORIES = {
  grocery: { name: 'Grocery', icon: '🥫', color: '#f59e0b', fixtures: ['shelf', 'shelf_large', 'endcap'] },
  fridge:  { name: 'Refrigerated', icon: '🥛', color: '#38bdf8', fixtures: ['fridge', 'fridge_large'] },
  frozen:  { name: 'Frozen', icon: '🧊', color: '#818cf8', fixtures: ['freezer', 'freezer_upright'] },
  produce: { name: 'Produce', icon: '🍎', color: '#22c55e', fixtures: ['produce'] },
  meat:    { name: 'Butcher', icon: '🥩', color: '#ef4444', fixtures: ['butcher'] },
  deli:    { name: 'Deli', icon: '🧀', color: '#eab308', fixtures: ['deli'] },
  // baked on site: dough is delivered in boxes, baked in the oven, then goes on the bread rack
  bakery: { name: 'Bakery', icon: '🥖', color: '#d97706', fixtures: ['bakery'] },
  // cleaning & toiletries share the gondola shelves with groceries
  household: { name: 'Household', icon: '🧴', color: '#06b6d4', fixtures: ['shelf', 'shelf_large', 'endcap'] },
};
// can this product go on that fixture?
export function fitsFixture(pid, type) { const p = PRODUCT_MAP[pid]; return !!p && (CATEGORIES[p.cat]?.fixtures || []).includes(type); }
// the departments a fixture can hold
export function fixtureCats(type) { return Object.keys(CATEGORIES).filter(c => CATEGORIES[c].fixtures.includes(type)); }

// shape: how a single unit is drawn on a shelf. color: main colour. cost: per unit from supplier.
// price: suggested retail price. box: units per delivery box. life: shelf life in days.
export const PRODUCTS = [
  // ---------------- Grocery ----------------
  { id: 'cereal',      name: 'Corn Flakes',     cat: 'grocery', cost: 1.60, price: 3.99, box: 12, shape: 'box',     color: 0xf4b400, life: 40, level: 1, icon: '🥣' },
  { id: 'pasta',       name: 'Spaghetti',          cat: 'grocery', cost: 0.80, price: 1.99, box: 12, shape: 'flatbox', color: 0x2563eb, life: 90, level: 1, icon: '🍝' },
  { id: 'rice',        name: 'Jasmine Rice',       cat: 'grocery', cost: 1.20, price: 2.79, box: 12, shape: 'bag',     color: 0xfafaf9, life: 120, level: 1, icon: '🍚' },
  { id: 'beans',       name: 'Canned Beans',       cat: 'grocery', cost: 0.55, price: 1.49, box: 12, shape: 'can',     color: 0xb91c1c, life: 120, level: 1, icon: '🥫' },
  { id: 'chips',       name: 'Potato Chips',       cat: 'grocery', cost: 0.90, price: 2.49, box: 12, shape: 'bag',     color: 0xfacc15, life: 50, level: 1, icon: '🥔' },
  { id: 'cookies',     name: 'Chocolate Chip Cookies',      cat: 'grocery', cost: 1.10, price: 2.99, box: 12, shape: 'flatbox', color: 0x7c2d12, life: 60, level: 1, icon: '🍪' },
  { id: 'soda',        name: 'Cola Classic',         cat: 'grocery', cost: 0.45, price: 1.29, box: 12, shape: 'bottle',  color: 0xdc2626, life: 120, level: 1, icon: '🥤' },
  { id: 'water',       name: 'Spring Water',       cat: 'grocery', cost: 0.25, price: 0.89, box: 12, shape: 'bottle',  color: 0x7dd3fc, life: 200, level: 1, icon: '💧' },
  { id: 'coffee',      name: 'Ground Coffee',     cat: 'grocery', cost: 2.80, price: 6.49, box: 12, shape: 'can',     color: 0x44403c, life: 120, level: 2, icon: '☕' },
  { id: 'tomsauce',    name: 'Tomato Sauce',       cat: 'grocery', cost: 0.70, price: 1.89, box: 12, shape: 'jar',     color: 0xef4444, life: 100, level: 2, icon: '🍅' },
  { id: 'chocolate',   name: 'Milk Chocolate',     cat: 'grocery', cost: 0.70, price: 1.99, box: 12, shape: 'flatbox', color: 0x92400e, life: 80, level: 2, icon: '🍫' },
  { id: 'oil',         name: 'Olive Oil',          cat: 'grocery', cost: 3.20, price: 7.49, box: 12, shape: 'bottle',  color: 0x65a30d, life: 150, level: 1, icon: '🫒' },
  { id: 'flour',       name: 'Baking Flour',       cat: 'grocery', cost: 0.90, price: 2.29, box: 12, shape: 'bag',     color: 0xfef3c7, life: 120, level: 1, icon: '🌾' },
  { id: 'sugar',       name: 'White Sugar',        cat: 'grocery', cost: 0.80, price: 1.99, box: 12, shape: 'bag',     color: 0xf1f5f9, life: 300, level: 1, icon: '🧂' },
  { id: 'pbutter',     name: 'Peanut Butter',      cat: 'grocery', cost: 1.50, price: 3.79, box: 12, shape: 'jar',     color: 0xd97706, life: 120, level: 3, icon: '🥜' },
  { id: 'honey',       name: 'Wildflower Honey',   cat: 'grocery', cost: 2.40, price: 5.49, box: 12, shape: 'jar',     color: 0xfbbf24, life: 200, level: 4, icon: '🍯' },
  { id: 'catfood',     name: 'Cat Food Chicken',     cat: 'grocery', cost: 0.60, price: 1.59, box: 12, shape: 'can',     color: 0xa855f7, life: 150, level: 4, icon: '🐱' },
  { id: 'toiletpaper', name: 'Toilet Tissue 12 Rolls',  cat: 'household', cost: 3.40, price: 7.49, box: 6, shape: 'pack',    color: 0xf0f9ff, life: 400, level: 2, icon: '🧻' },
  { id: 'energy',      name: 'Energy Drink',   cat: 'grocery', cost: 0.90, price: 2.49, box: 12, shape: 'can',     color: 0x22d3ee, life: 150, level: 5, icon: '⚡' },
  { id: 'detergent',   name: 'Laundry Detergent',  cat: 'household', cost: 3.50, price: 8.49, box: 6,  shape: 'jug',     color: 0x0ea5e9, life: 400, level: 4, icon: '🧴' },
  { id: 'bleach',      name: 'Lemon Bleach 2L',    cat: 'household', cost: 1.10, price: 2.79, box: 6,  shape: 'jug',     color: 0xf8fafc, life: 400, level: 2, icon: '🧴' },
  { id: 'dishsoap',    name: 'Dish Soap Lemon',    cat: 'household', cost: 0.90, price: 2.29, box: 12, shape: 'squeeze', color: 0xfacc15, life: 400, level: 2, icon: '🧴' },
  { id: 'shampoo',     name: 'Shampoo Classic Clean', cat: 'household', cost: 1.60, price: 4.29, box: 12, shape: 'squeeze', color: 0x1d4ed8, life: 400, level: 3, icon: '🧴' },
  { id: 'soap',        name: 'Bath Soap 4 Pack',   cat: 'household', cost: 0.80, price: 2.19, box: 12, shape: 'flatbox', color: 0xf9a8d4, life: 400, level: 3, icon: '🧼' },
  { id: 'washpowder',  name: 'Washing Powder 3kg', cat: 'household', cost: 3.20, price: 7.99, box: 6,  shape: 'pouch',   color: 0x16a34a, life: 400, level: 3, icon: '🧺' },
  { id: 'wine',        name: 'Cabernet Sauvignon',   cat: 'grocery', cost: 5.50, price: 13.99, box: 8, shape: 'bottle',  color: 0x7f1d1d, life: 400, level: 7, icon: '🍷' },
  { id: 'truffle',     name: 'Truffle Pasta',      cat: 'grocery', cost: 4.00, price: 9.99, box: 8,  shape: 'flatbox', color: 0x1c1917, life: 120, level: 8, icon: '✨' },

  // ---------------- Refrigerated ----------------
  { id: 'milk',        name: 'Fresh Milk',         cat: 'fridge', cost: 0.75, price: 1.99, box: 10, shape: 'carton',  color: 0xffffff, life: 7, level: 1, icon: '🥛' },
  { id: 'yogurt',      name: 'Strawberry Yogurt',  cat: 'fridge', cost: 0.45, price: 1.29, box: 12, shape: 'tub',     color: 0xf9a8d4, life: 9, level: 1, icon: '🍓' },
  { id: 'butter',      name: 'Creamy Butter',      cat: 'fridge', cost: 1.20, price: 2.99, box: 12, shape: 'flatbox', color: 0xfde047, life: 20, level: 1, icon: '🧈' },
  { id: 'eggs',        name: 'Free-Range Eggs',    cat: 'fridge', cost: 1.40, price: 3.49, box: 10, shape: 'flatbox', color: 0xfef3c7, life: 14, level: 1, icon: '🥚' },
  { id: 'cheese',      name: 'Cheddar Slices',     cat: 'fridge', cost: 1.60, price: 3.89, box: 12, shape: 'flatbox', color: 0xf97316, life: 18, level: 2, icon: '🧀' },
  { id: 'juice',       name: 'Orange Juice',       cat: 'fridge', cost: 1.10, price: 2.89, box: 10, shape: 'carton',  color: 0xfb923c, life: 10, level: 2, icon: '🧃' },
  { id: 'cream',       name: 'Whipping Cream',     cat: 'fridge', cost: 0.90, price: 2.29, box: 12, shape: 'carton',  color: 0xe0f2fe, life: 10, level: 3, icon: '🍦' },
  { id: 'salad',       name: 'Ready Salad Bowl',   cat: 'fridge', cost: 1.80, price: 4.49, box: 10, shape: 'tub',     color: 0x4ade80, life: 4, level: 5, icon: '🥗' },
  { id: 'kombucha',    name: 'Ginger Kombucha',    cat: 'fridge', cost: 1.70, price: 4.29, box: 10, shape: 'bottle',  color: 0xfcd34d, life: 30, level: 7, icon: '🫚' },

  // ---------------- Frozen ----------------
  { id: 'pizza',       name: 'Frozen Pizza',       cat: 'frozen', cost: 2.00, price: 4.99, box: 10, shape: 'flatbox', color: 0xdc2626, life: 90, level: 3, icon: '🍕' },
  { id: 'icecream',    name: 'Vanilla Ice Cream',  cat: 'frozen', cost: 1.80, price: 4.49, box: 10, shape: 'tub',     color: 0xfef9c3, life: 90, level: 3, icon: '🍨' },
  { id: 'fries',       name: 'Frozen Fries',       cat: 'frozen', cost: 1.10, price: 2.79, box: 10, shape: 'bag',     color: 0xfacc15, life: 120, level: 3, icon: '🍟' },
  { id: 'veggies',     name: 'Frozen Mixed Vegetables',  cat: 'frozen', cost: 0.90, price: 2.29, box: 10, shape: 'bag',     color: 0x16a34a, life: 120, level: 3, icon: '🥦' },
  { id: 'fishsticks',  name: 'Fish Sticks',        cat: 'frozen', cost: 1.90, price: 4.59, box: 10, shape: 'flatbox', color: 0x1d4ed8, life: 120, level: 4, icon: '🐟' },
  { id: 'dumplings',   name: 'Frozen Dumplings',   cat: 'frozen', cost: 2.20, price: 5.29, box: 10, shape: 'bag',     color: 0xf5f5f4, life: 120, level: 5, icon: '🥟' },
  { id: 'popsicles',   name: 'Fruit Ice Lollies',  cat: 'frozen', cost: 1.50, price: 3.79, box: 10, shape: 'box',     color: 0xec4899, life: 150, level: 6, icon: '🍭' },
  { id: 'frozenmeat',  name: 'Frozen Burgers',     cat: 'frozen', cost: 3.20, price: 7.49, box: 10, shape: 'box',     color: 0x991b1b, life: 120, level: 6, icon: '🍔' },

  // ---------------- Produce ----------------
  { id: 'apples',      name: 'Red Apples',         cat: 'produce', cost: 0.30, price: 0.89, box: 16, shape: 'sphere',  color: 0xdc2626, life: 8, level: 2, icon: '🍎' },
  { id: 'bananas',     name: 'Bananas',            cat: 'produce', cost: 0.20, price: 0.59, box: 16, shape: 'long',    color: 0xfde047, life: 5, level: 2, icon: '🍌' },
  { id: 'tomatoes',    name: 'Vine Tomatoes',      cat: 'produce', cost: 0.35, price: 0.99, box: 16, shape: 'sphere',  color: 0xef4444, life: 6, level: 2, icon: '🍅' },
  { id: 'lettuce',     name: 'Crisp Lettuce',      cat: 'produce', cost: 0.50, price: 1.39, box: 12, shape: 'sphere',  color: 0x84cc16, life: 5, level: 2, icon: '🥬' },
  { id: 'carrots',     name: 'Carrots',            cat: 'produce', cost: 0.25, price: 0.79, box: 16, shape: 'long',    color: 0xf97316, life: 10, level: 3, icon: '🥕' },
  { id: 'oranges',     name: 'Navel Oranges',      cat: 'produce', cost: 0.35, price: 0.99, box: 16, shape: 'sphere',  color: 0xfb923c, life: 9, level: 3, icon: '🍊' },
  { id: 'potatoes',    name: 'Potatoes',           cat: 'produce', cost: 0.20, price: 0.69, box: 16, shape: 'sphere',  color: 0xa16207, life: 15, level: 4, icon: '🥔' },
  { id: 'avocados',    name: 'Ripe Avocados',      cat: 'produce', cost: 0.80, price: 1.99, box: 12, shape: 'sphere',  color: 0x3f6212, life: 5, level: 6, icon: '🥑' },
  { id: 'strawberry',  name: 'Strawberries',       cat: 'produce', cost: 1.30, price: 3.29, box: 12, shape: 'tub',     color: 0xe11d48, life: 4, level: 7, icon: '🍓' },

  // ---------------- Butcher (served at counter) ----------------
  { id: 'groundbeef',  name: 'Ground Beef',        cat: 'meat', cost: 2.40, price: 5.99, box: 8, shape: 'slab', color: 0xb91c1c, life: 4, level: 4, icon: '🥩', unit: '500g' },
  { id: 'chicken',     name: 'Chicken Breast',     cat: 'meat', cost: 2.10, price: 5.49, box: 8, shape: 'slab', color: 0xfda4af, life: 4, level: 4, icon: '🍗', unit: '500g' },
  { id: 'sausages',    name: 'Pork Sausages',      cat: 'meat', cost: 1.80, price: 4.49, box: 8, shape: 'long', color: 0xc2410c, life: 5, level: 4, icon: '🌭', unit: '6 pcs' },
  { id: 'ribeye',      name: 'Ribeye Steak',       cat: 'meat', cost: 6.00, price: 14.99, box: 6, shape: 'slab', color: 0x991b1b, life: 4, level: 5, icon: '🥩', unit: '300g' },
  { id: 'lamb',        name: 'Lamb Chops',         cat: 'meat', cost: 5.00, price: 12.49, box: 6, shape: 'slab', color: 0xbe123c, life: 4, level: 6, icon: '🍖', unit: '400g' },
  { id: 'ribs',        name: 'BBQ Pork Ribs',      cat: 'meat', cost: 4.20, price: 9.99, box: 6, shape: 'slab', color: 0x9a3412, life: 4, level: 7, icon: '🍖', unit: '1kg' },
  { id: 'wagyu',       name: 'Wagyu Steak',        cat: 'meat', cost: 18.0, price: 39.99, box: 4, shape: 'slab', color: 0xf43f5e, life: 4, level: 9, icon: '🌟', unit: '250g' },

  // ---------------- Deli (served at counter) ----------------
  { id: 'ham',         name: 'Sliced Ham',         cat: 'deli', cost: 1.50, price: 3.99, box: 8, shape: 'slab',   color: 0xfda4af, life: 5, level: 5, icon: '🥓', unit: '200g' },
  { id: 'salami',      name: 'Italian Salami',     cat: 'deli', cost: 2.00, price: 4.99, box: 8, shape: 'long',   color: 0x9f1239, life: 8, level: 5, icon: '🍕', unit: '150g' },
  { id: 'gouda',       name: 'Aged Gouda',         cat: 'deli', cost: 2.40, price: 5.99, box: 8, shape: 'wedge',  color: 0xfacc15, life: 12, level: 5, icon: '🧀', unit: '250g' },
  { id: 'olives',      name: 'Marinated Olives',   cat: 'deli', cost: 1.40, price: 3.79, box: 8, shape: 'tub',    color: 0x4d7c0f, life: 10, level: 5, icon: '🫒', unit: '200g' },
  { id: 'potsalad',    name: 'Potato Salad',       cat: 'deli', cost: 1.10, price: 2.99, box: 8, shape: 'tub',    color: 0xfef08a, life: 4, level: 6, icon: '🥔', unit: '300g' },
  { id: 'hummus',      name: 'Fresh Hummus',       cat: 'deli', cost: 1.20, price: 3.29, box: 8, shape: 'tub',    color: 0xd6d3d1, life: 6, level: 6, icon: '🥙', unit: '250g' },
  { id: 'roastchicken',name: 'Rotisserie Chicken', cat: 'deli', cost: 3.50, price: 8.99, box: 6, shape: 'sphere', color: 0xc2410c, life: 3, level: 7, icon: '🍗', unit: 'whole' },
  { id: 'sushi',       name: 'Sushi Platter',      cat: 'deli', cost: 5.00, price: 12.99, box: 6, shape: 'flatbox',color: 0xf8fafc, life: 2, level: 8, icon: '🍣', unit: '12 pcs' },
];

// bakery: delivered as ready-to-bake dough; one day fresh once baked
PRODUCTS.push(
  { id: 'bread',     name: 'Farmhouse Loaf',   cat: 'bakery', cost: 0.90, price: 2.99, box: 8,  shape: 'loaf',     color: 0xb9762f, life: 1, level: 3, icon: '🍞' },
  { id: 'rolls',     name: 'Bread Rolls',      cat: 'bakery', cost: 0.22, price: 0.79, box: 16, shape: 'bun',      color: 0xc98b3f, life: 1, level: 3, icon: '🥯' },
  { id: 'baguette',  name: 'Baguette',         cat: 'bakery', cost: 0.50, price: 1.79, box: 10, shape: 'stick',    color: 0xc68a3c, life: 1, level: 3, icon: '🥖' },
  { id: 'croissant', name: 'Butter Croissant', cat: 'bakery', cost: 0.45, price: 1.49, box: 12, shape: 'crescent', color: 0xd9963a, life: 1, level: 4, icon: '🥐' },
);
export const BAKE_SECONDS = 20;  // real seconds at 1x speed to bake one box
export const DOUGH_DAYS = 5;     // how long an unbaked box keeps
export const PRODUCT_MAP = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

// minOrder = minimum boxes per order. time = delivery time in real seconds at 1x speed.
// discounts: [boxes, percent off product subtotal]
export const SUPPLIERS = [
  { id: 'pantry',  name: 'Pantry Wholesale',   icon: '📦', cats: ['grocery'], fee: 10, time: 40, minOrder: 1, markup: 1.0,  discounts: [[6, 5], [12, 10], [24, 15]], level: 1, desc: 'Cheap dry goods in bulk.' },
  { id: 'dairy',   name: 'Daily Dairy Co.',    icon: '🐄', cats: ['fridge'],  fee: 25, time: 35, minOrder: 2, markup: 1.0,  discounts: [[6, 5], [12, 8]], level: 1, desc: 'Fresh milk & chilled goods every morning.' },
  { id: 'green',   name: 'Green Valley Farms', icon: '🚜', cats: ['produce'], fee: 20, time: 30, minOrder: 2, markup: 1.0,  discounts: [[8, 6], [16, 12]], level: 2, desc: 'Farm-fresh fruit and vegetables.' },
  { id: 'polar',   name: 'Polar Frozen Foods', icon: '🐻‍❄️', cats: ['frozen'], fee: 30, time: 50, minOrder: 2, markup: 1.0,  discounts: [[6, 6], [12, 12]], level: 3, desc: 'Everything sub-zero.' },
  { id: 'prime',   name: 'Prime Cuts Meats',   icon: '🔪', cats: ['meat'],    fee: 35, time: 40, minOrder: 1, markup: 1.0,  discounts: [[5, 5], [10, 10]], level: 4, desc: 'Quality butcher supply.' },
  { id: 'miller',  name: "Miller's Bakehouse", icon: '🥖', cats: ['bakery'], fee: 15, time: 30, minOrder: 1, markup: 1.0, discounts: [[4, 5], [8, 10]], level: 3, desc: 'Ready-to-bake dough. Bake it in your own oven.' },
  { id: 'cleanco', name: 'CleanCo Supply',     icon: '🧴', cats: ['household'], fee: 20, time: 45, minOrder: 2, markup: 1.0, discounts: [[6, 5], [12, 10]], level: 2, desc: 'Cleaning products and toiletries.' },
  { id: 'bella',   name: 'Bella Deli Imports', icon: '🇮🇹', cats: ['deli'],   fee: 30, time: 45, minOrder: 1, markup: 1.0,  discounts: [[5, 5], [10, 10]], level: 5, desc: 'Cheeses, cold cuts & antipasti.' },
  { id: 'express', name: 'QuickMart Express',  icon: '⚡', cats: ['grocery', 'household', 'bakery', 'fridge', 'frozen', 'produce', 'meat', 'deli'], fee: 60, time: 12, minOrder: 1, markup: 1.2, discounts: [], level: 6, desc: 'Anything, fast. Premium prices.' },
  { id: 'mega',    name: 'MegaBulk Distributors', icon: '🏭', cats: ['grocery', 'household', 'frozen'], fee: 45, time: 90, minOrder: 10, markup: 0.9, discounts: [[20, 10], [40, 18]], level: 8, desc: 'Huge orders, huge savings, slow trucks.' },
];
export const SUPPLIER_MAP = Object.fromEntries(SUPPLIERS.map(s => [s.id, s]));

// kind: storage (holds products), checkout, selfcheckout, counter (served dept), rack (holds boxes), decor
// w,d: footprint tiles before rotation. slots: product slots (each holds one product type). cap: units per slot.
// power: electricity $/day. maint: maintenance $/day. appeal: store attractiveness. level: unlock level.
export const FURNITURE = {
  shelf:          { name: 'Grocery Shelf',      cat: 'grocery', kind: 'storage', w: 2, d: 1, slots: 8, cap: 60, cost: 250, power: 0, maint: 1, appeal: 0, level: 1, icon: '🗄️', desc: 'Metal gondola: 4 tiers, 2 product sections each.' },
  shelf_large:    { name: 'Tall Grocery Shelf', cat: 'grocery', kind: 'storage', w: 3, d: 1, slots: 15, cap: 60, cost: 480, power: 0, maint: 2, appeal: 0, level: 5, icon: '🏬', desc: '5 tiers × 3 sections. Holds a lot.' },
  endcap:         { name: 'Promo Endcap',       cat: 'grocery', kind: 'storage', w: 1, d: 1, slots: 4, cap: 40, cost: 180, power: 0, maint: 1, appeal: 1, level: 3, icon: '🏷️', desc: 'Small display. Customers love impulse buys here.', impulse: 0.35 },
  fridge:         { name: 'Dairy Fridge',       cat: 'fridge',  kind: 'storage', w: 2, d: 1, slots: 10, cap: 50, cost: 700, power: 9, maint: 2, appeal: 0, level: 1, icon: '🧊', desc: 'Glass-door fridge for chilled goods.', temp: 3, maxTemp: 8 },
  fridge_large:   { name: 'Walk-by Fridge Wall',cat: 'fridge',  kind: 'storage', w: 3, d: 1, slots: 15, cap: 50, cost: 1300,power: 14, maint: 3, appeal: 1, level: 6, icon: '❄️', desc: 'Huge open-front chiller.', temp: 3, maxTemp: 8 },
  freezer:        { name: 'Chest Freezer',      cat: 'frozen',  kind: 'storage', w: 2, d: 1, slots: 4, cap: 60, cost: 800, power: 12, maint: 2, appeal: 0, level: 3, icon: '🧊', desc: 'Glass-top chest freezer.', temp: -18, maxTemp: -6 },
  freezer_upright:{ name: 'Upright Freezer',    cat: 'frozen',  kind: 'storage', w: 2, d: 1, slots: 10, cap: 50, cost: 1100,power: 15, maint: 3, appeal: 0, level: 6, icon: '🥶', desc: 'Tall frozen display with doors.', temp: -18, maxTemp: -6 },
  bakery:         { name: 'Bread Rack',         cat: 'bakery',  kind: 'storage', w: 2, d: 1, slots: 6, cap: 30, cost: 380, power: 0, maint: 1, appeal: 2, level: 3, icon: '🥖', desc: 'Wooden rack for bread baked in your oven.' },
  oven:           { name: 'Bakery Oven',        kind: 'oven', w: 1, d: 1, cost: 950, power: 14, maint: 2, appeal: 1, level: 3, icon: '🔥', desc: 'Bakes a box of dough into fresh bread in about 20 seconds.' },
  produce:        { name: 'Produce Stand',      cat: 'produce', kind: 'storage', w: 2, d: 1, slots: 4, cap: 40, cost: 320, power: 0, maint: 1, appeal: 2, level: 2, icon: '🧺', desc: 'Wooden crates of fresh produce.' },
  // Departments are 3x3: back row = big walk-in fridge + prep station, middle row = staff aisle (walkable), front row = display counter.
  butcher:        { name: 'Butcher Department', cat: 'meat',    kind: 'counter', w: 3, d: 3, tiles: [[0,0],[1,0],[2,0],[0,2],[1,2],[2,2]], staffRow: 1, slots: 4, cap: 16, cost: 1800,power: 10, maint: 3, appeal: 2, level: 4, icon: '🔪', desc: 'Display counter, big meat fridge and a cutting station behind it.', temp: 2, maxTemp: 7, presses: 5 },
  deli:           { name: 'Deli Department',    cat: 'deli',    kind: 'counter', w: 3, d: 3, tiles: [[0,0],[1,0],[2,0],[0,2],[1,2],[2,2]], staffRow: 1, slots: 4, cap: 16, cost: 1600,power: 8, maint: 3, appeal: 2, level: 5, icon: '🧀', desc: 'Display counter, cheese fridge and a cheese slicer behind it.', temp: 4, maxTemp: 8, presses: 4 },
  computer:       { name: 'Store Computer',     kind: 'computer', w: 2, d: 1, cost: 600, power: 1, maint: 0, appeal: 0, level: 1, icon: '🖥️', desc: 'Order stock, buy fixtures & licenses, hire staff, pay bills, read messages.' },
  checkout:       { name: 'Checkout Counter',   kind: 'checkout', w: 2, d: 1, cost: 500,  power: 2, maint: 2, appeal: 0, level: 1, icon: '🛒', desc: 'Belt + register. A player or cashier must operate it.' },
  selfcheckout:   { name: 'Self-Checkout Kiosk',kind: 'selfcheckout', w: 1, d: 1, cost: 1400, power: 3, maint: 4, appeal: 1, level: 6, icon: '🖥️', desc: 'Customers scan their own items (slowly).' },
  rack:           { name: 'Storage Rack',       kind: 'rack', w: 2, d: 1, boxes: 8, cost: 200, power: 0, maint: 0, appeal: -1, level: 1, icon: '🗃️', desc: 'Back-stock for 8 boxes. Stockers restock from here.' },
  bin:            { name: 'Trash Bin',          kind: 'decor', w: 1, d: 1, cost: 40,  power: 0, maint: 0, appeal: 0, level: 1, clean: 1, icon: '🗑️', desc: 'Fewer spills and litter nearby.' },
  plant:          { name: 'Potted Plant',       kind: 'decor', w: 1, d: 1, cost: 60,  power: 0, maint: 0, appeal: 2, level: 1, icon: '🪴', desc: 'A little green makes shoppers happy.' },
  flowerpot:      { name: 'Flower Pot',         kind: 'decor', w: 1, d: 1, cost: 45,  power: 0, maint: 0, appeal: 1, level: 1, icon: '🌷', desc: 'A small pot of tulips.' },
  cactus:         { name: 'Cactus',             kind: 'decor', w: 1, d: 1, cost: 70,  power: 0, maint: 0, appeal: 2, level: 2, icon: '🌵', desc: 'Low maintenance, high style.' },
  plant_tall:     { name: 'Tall Ficus Tree',    kind: 'decor', w: 1, d: 1, cost: 160, power: 0, maint: 0, appeal: 4, level: 3, icon: '🌳', desc: 'An indoor tree for a fresh feel.' },
  lamp:           { name: 'Floor Lamp',         kind: 'decor', w: 1, d: 1, cost: 90,  power: 1, maint: 0, appeal: 2, level: 2, icon: '💡', desc: 'Warm cozy light.' },
  sign:           { name: 'Sale Sign',          kind: 'decor', w: 1, d: 1, cost: 70,  power: 0, maint: 0, appeal: 2, level: 2, icon: '🪧', desc: '"Fresh deals!" Shoppers notice.' },
  bench:          { name: 'Bench',              kind: 'decor', w: 2, d: 1, cost: 150, power: 0, maint: 0, appeal: 3, level: 3, icon: '🪑', desc: 'A place to rest tired feet.' },
  balloons:       { name: 'Promo Display',      kind: 'decor', w: 1, d: 1, cost: 120, power: 0, maint: 0, appeal: 4, level: 4, icon: '🎈', desc: 'Cardboard stand for the weekly offers.' },
  vending:        { name: 'Vending Machine',    kind: 'decor', w: 1, d: 1, cost: 650, power: 3, maint: 1, appeal: 1, level: 4, icon: '🥤', desc: 'Earns a little passive income each day.', income: 45 },
  flowers:        { name: 'Flower Display',     kind: 'decor', w: 2, d: 1, cost: 380, power: 0, maint: 1, appeal: 7, level: 7, icon: '💐', desc: 'Premium fresh flower stand.' },
  fountain:       { name: 'Café Seating',       kind: 'decor', w: 2, d: 2, cost: 1500,power: 2, maint: 2, appeal: 14, level: 7, icon: '⛲', desc: 'Tables and chairs for a café corner.' },
  neon:           { name: 'Digital Signage',    kind: 'decor', w: 1, d: 1, cost: 600, power: 2, maint: 0, appeal: 8, level: 8, icon: '🌈', desc: "Screen showing this week's deals." },
  statue:         { name: 'Coffee Kiosk',       kind: 'decor', w: 1, d: 1, cost: 3000,power: 0, maint: 0, appeal: 20, level: 10, icon: '🏆', desc: 'Self-serve coffee bar for shoppers.' },
};

// Per-fixture upgrades available in build mode.
export const FIXTURE_UPGRADES = {
  storage:  { name: 'Eco Upgrade', cost: 300, desc: 'Halves electricity and makes breakdowns rare.', level: 3 },
  counter:  { name: 'Pro Tools', cost: 450, desc: 'Faster preparation (+40%) and fewer breakdowns.', level: 5 },
  checkout: { name: 'Laser Scanner', cost: 350, desc: 'Scans 50% faster for cashiers, and 2 items per press for players.', level: 2 },
  selfcheckout: { name: 'Smart Kiosk', cost: 500, desc: 'Customers scan 60% faster.', level: 7 },
  rack:     { name: 'Extra Tier', cost: 150, desc: '+4 box capacity.', level: 2 },
};

export const EXPANSIONS = [
  { w: 12, d: 9,  cost: 0,     level: 1, rent: 40 },
  { w: 16, d: 10, cost: 2500,  level: 3, rent: 70 },
  { w: 20, d: 12, cost: 6000,  level: 5, rent: 110 },
  { w: 24, d: 13, cost: 12000, level: 7, rent: 160 },
  { w: 24, d: 13, cost: 25000, level: 9, rent: 240, floors: 2 }, // a real second floor with stairs
];
// Stairs (used once the 2nd floor exists): a 2-tile wide ramp along the right wall.
export function stairInfo(W) { return { x: W - 2, z0: 1, z1: 5 }; } // ramp tiles z0..z1-1, bottom entry at z1 (ground), landing at z0-1 (upstairs)
export const FURNITURE_SUPPLIER = { id: 'fixtures', name: 'FixturePro Store Supply', icon: '🪑', fee: 25, time: 20 };
export function licenseCost(p) { return STARTER_PRODUCTS.includes(p.id) ? 0 : Math.max(50, Math.min(200, Math.round(p.price * 25 / 10) * 10)); }
export function priceLimits(p) { return [Math.ceil(p.cost * 1.05 * 20) / 20, Math.round(p.price * 2 * 100) / 100]; }

export const FLOORS = [
  { id: 'white',   name: 'Clean White Tile', a: '#f1f5f9', b: '#e2e8f0', cost: 0,    level: 1 },
  { id: 'checker', name: 'Retro Checker',    a: '#f8fafc', b: '#94a3b8', cost: 300,  level: 1 },
  { id: 'mint',    name: 'Mint Tile',        a: '#d1fae5', b: '#a7f3d0', cost: 400,  level: 2 },
  { id: 'wood',    name: 'Warm Oak',         a: '#d6a76c', b: '#c08f55', cost: 800,  level: 3, plank: true },
  { id: 'terra',   name: 'Terracotta',       a: '#fdba74', b: '#fb923c', cost: 700,  level: 4 },
  { id: 'marble',  name: 'Polished Marble',  a: '#fafaf9', b: '#e7e5e4', cost: 2000, level: 6, marble: true },
  { id: 'night',   name: 'Midnight Slate',   a: '#334155', b: '#1e293b', cost: 1500, level: 7 },
];

export const WALLS = [
  { id: 'cream',  name: 'Cream',       color: '#fef3c7', cost: 0,   level: 1 },
  { id: 'sky',    name: 'Sky Blue',    color: '#bae6fd', cost: 200, level: 1 },
  { id: 'mint',   name: 'Fresh Mint',  color: '#bbf7d0', cost: 200, level: 1 },
  { id: 'peach',  name: 'Peach',       color: '#fed7aa', cost: 200, level: 2 },
  { id: 'lilac',  name: 'Lilac',       color: '#e9d5ff', cost: 250, level: 3 },
  { id: 'coral',  name: 'Coral Red',   color: '#fca5a5', cost: 250, level: 3 },
  { id: 'forest', name: 'Deep Forest', color: '#166534', cost: 600, level: 6 },
  { id: 'navy',   name: 'Royal Navy',  color: '#1e3a8a', cost: 600, level: 6 },
];

export const LIGHTS = [
  { id: 'standard', name: 'Standard Lighting', color: '#fff1d0', cost: 0,    level: 1, appeal: 0, icon: '💡' },
  { id: 'warm',     name: 'Cozy Warm',         color: '#ffcf8a', cost: 400,  level: 2, appeal: 2, icon: '🕯️' },
  { id: 'cool',     name: 'Crisp Daylight',    color: '#d6ecff', cost: 400,  level: 2, appeal: 2, icon: '❄️' },
  { id: 'gallery',  name: 'Gallery Spotlights',color: '#ffffff', cost: 1500, level: 5, appeal: 5, icon: '✨' },
  { id: 'disco',    name: 'Party Disco',       color: 'rainbow', cost: 2500, level: 7, appeal: 6, icon: '🪩' },
];

// Team-wide upgrades bought from the "Upgrades" tab.
export const TEAM_UPGRADES = [
  { id: 'handtruck',   name: 'Hand Trucks',        icon: '🛞', cost: 600,  level: 2, desc: 'Every player can carry 3 boxes at once.' },
  { id: 'palletjack',  name: 'Pallet Jacks',       icon: '🏗️', cost: 2500, level: 5, desc: 'Every player can carry 6 boxes at once.', requires: 'handtruck' },
  { id: 'carts',       name: 'Bigger Shopping Carts', icon: '🛒', cost: 800,  level: 3, desc: 'Customers buy up to 3 more items each.' },
  { id: 'trolleys',    name: 'Staff Trolleys',     icon: '🚚', cost: 1200, level: 4, desc: 'Shelf stockers carry 2 boxes per trip.' },
  { id: 'led',         name: 'LED Lighting',       icon: '💡', cost: 1500, level: 4, desc: '-30% electricity, +5 store appeal.' },
  { id: 'music',       name: 'In-Store Radio',     icon: '📻', cost: 700,  level: 3, desc: 'Customers are more patient (+20%).' },
  { id: 'loyalty',     name: 'Loyalty Cards',      icon: '💳', cost: 3000, level: 6, desc: '+15% more customers every day.' },
  { id: 'breakroom',   name: 'Staff Break Room',   icon: '☕', cost: 2000, level: 5, desc: 'Employee happiness recovers much faster.' },
  { id: 'adcampaign',  name: 'Billboard Ads',      icon: '📣', cost: 5000, level: 8, desc: '+25% more customers every day.' },
];
export const TEAM_UPGRADE_MAP = Object.fromEntries(TEAM_UPGRADES.map(u => [u.id, u]));

export const HIRE_FEE_DAYS = 1; // recruitment fee, in days of the new employee's wage
export const ROLES = {
  // staff only become available as the store grows; hiring costs one day's wage up front (HIRE_FEE_DAYS)
  cashier: { name: 'Cashier',       icon: '💵', baseSalary: 88,  level: 3, color: 0x2563eb, desc: 'Operates a checkout counter.' },
  stocker: { name: 'Shelf Stocker', icon: '📦', baseSalary: 81,  level: 3, color: 0x16a34a, desc: 'Moves boxes onto shelves and keeps them full.' },
  cleaner: { name: 'Cleaner',       icon: '🧹', baseSalary: 69,  level: 4, color: 0x0891b2, desc: 'Cleans spills and litter.' },
  guard:   { name: 'Security Guard', icon: '🛡️', baseSalary: 94, level: 4, color: 0x1e293b, desc: 'Stands by the entrance and catches shoplifters.' },
  butcher: { name: 'Butcher',       icon: '🔪', baseSalary: 119, level: 6, color: 0x991b1b, desc: 'Serves customers at the butcher counter.' },
  deli:    { name: 'Deli Clerk',    icon: '🧀', baseSalary: 106, level: 7, color: 0xca8a04, desc: 'Serves customers at the deli counter.' },
};

export const SHIFTS = {
  full:    { name: 'Full Day', start: 8,  end: 22, pay: 1.0 },
  morning: { name: 'Morning',  start: 8,  end: 15, pay: 0.55 },
  evening: { name: 'Evening',  start: 15, end: 22, pay: 0.55 },
};

export const PLAYER_ROLES = {
  manager:  { name: 'Manager',   icon: '🧑‍💼', desc: 'Orders stock, sets prices, plans the store.' },
  cashier:  { name: 'Cashier',   icon: '💵', desc: 'Runs the registers.' },
  stocker:  { name: 'Stocker',   icon: '📦', desc: 'Hauls boxes and fills shelves.' },
  counter:  { name: 'Butcher & Deli', icon: '🔪', desc: 'Serves the counters.' },
  builder:  { name: 'Builder',   icon: '🛠️', desc: 'Builds, decorates and expands.' },
};

export const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

// XP needed to *reach* each level (index = level-1)
export const LEVEL_XP = [0, 150, 500, 1200, 2500, 4500, 7500, 12000, 18000, 26000];
export const MAX_LEVEL = LEVEL_XP.length;

export function levelForXp(xp) {
  let lvl = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lvl = i + 1;
  return lvl;
}

export const ACHIEVEMENTS = [
  { id: 'first_sale',   name: 'Grand Opening',     icon: '🎉', desc: 'Make your first sale.' },
  { id: 'customers50',  name: 'Getting Popular',   icon: '👥', desc: 'Serve 50 customers.' },
  { id: 'customers500', name: 'Neighbourhood Hub', icon: '🏘️', desc: 'Serve 500 customers.' },
  { id: 'customers2k',  name: 'Retail Empire',     icon: '🌆', desc: 'Serve 2,000 customers.' },
  { id: 'rev1k',        name: 'Four Digits',       icon: '💵', desc: 'Earn $1,000 total revenue.' },
  { id: 'rev25k',       name: 'Big Business',      icon: '💰', desc: 'Earn $25,000 total revenue.' },
  { id: 'rev100k',      name: 'Top of the Market', icon: '👑', desc: 'Earn $100,000 total revenue.' },
  { id: 'day_profit',   name: 'In the Black',      icon: '📈', desc: 'Finish a day with profit.' },
  { id: 'big_day',      name: 'Blockbuster Day',   icon: '🚀', desc: 'Earn $3,000 revenue in a single day.' },
  { id: 'first_hire',   name: 'Team Player',       icon: '🤝', desc: 'Hire your first employee.' },
  { id: 'staff5',       name: 'Growing Crew',      icon: '👷', desc: 'Have 5 employees at once.' },
  { id: 'butcher',      name: 'Cut Above',         icon: '🔪', desc: 'Serve a butcher customer.' },
  { id: 'deli',         name: 'Say Cheese',        icon: '🧀', desc: 'Serve a deli customer.' },
  { id: 'expand',       name: 'More Room',         icon: '📐', desc: 'Expand your supermarket.' },
  { id: 'expand_max',   name: 'Hypermarket',       icon: '🏟️', desc: 'Fully expand your supermarket.' },
  { id: 'level5',       name: 'Rising Star',       icon: '⭐', desc: 'Reach store level 5.' },
  { id: 'level10',      name: 'Superstar Store',   icon: '🌟', desc: 'Reach store level 10.' },
  { id: 'five_star',    name: 'Five Stars',        icon: '🏅', desc: 'Reach a 4.5★ reputation.' },
  { id: 'perfect_day',  name: 'Flawless Day',      icon: '💎', desc: 'A full day (20+ customers) with no angry customers.' },
  { id: 'repairman',    name: 'Fix-It Crew',       icon: '🔧', desc: 'Repair a broken fridge or freezer by hand.' },
  { id: 'scanner',      name: 'Speed Scanner',     icon: '⚡', desc: 'Personally check out 25 customers.' },
  { id: 'vip',          name: 'VIP Treatment',     icon: '🕶️', desc: 'Satisfy a VIP customer request.' },
  { id: 'guardian',     name: 'Not On My Watch',   icon: '🛡️', desc: 'Catch a shoplifter.' },
  { id: 'decorator',    name: 'Interior Designer', icon: '🎨', desc: 'Reach 40 store appeal.' },
  { id: 'all_depts',    name: 'Full Service',      icon: '🏪', desc: 'Have all 6 departments running.' },
];

// The guided goal chain. Each has a check computed on the server and a cash reward.
export const GOALS = [
  { id: 'name',        text: 'Agree on a name for your supermarket', reward: 0 },
  { id: 'shelf',       text: 'Buy and place a Grocery Shelf (Build: B)', reward: 50 },
  { id: 'checkout',    text: 'Place a Checkout Counter', reward: 50 },
  { id: 'order',       text: 'Order products from a supplier (Orders: O)', reward: 50 },
  { id: 'stock',       text: 'Carry a delivery box inside and stock a shelf (E)', reward: 75 },
  { id: 'fridge',      text: 'Place a Dairy Fridge and stock it with milk', reward: 100 },
  { id: 'open',        text: 'Open the store for business!', reward: 50 },
  { id: 'sale',        text: 'Check out a customer at the register', reward: 100 },
  { id: 'hire',        text: 'Hire your first employee (Staff: H)', reward: 150 },
  { id: 'day1',        text: 'Finish your first day', reward: 200 },
  { id: 'customers30', text: 'Serve 30 customers in total', reward: 200 },
  { id: 'decor',       text: 'Raise store appeal to 10 with decorations', reward: 200 },
  { id: 'produce',     text: 'Open a produce section (Level 2)', reward: 300 },
  { id: 'expand1',     text: 'Expand your supermarket', reward: 400 },
  { id: 'freezer',     text: 'Run a frozen food section (Level 3)', reward: 400 },
  { id: 'butcher',     text: 'Serve a customer at the Butcher Counter (Level 4)', reward: 600 },
  { id: 'deli',        text: 'Serve a customer at the Deli Counter (Level 5)', reward: 700 },
  { id: 'rev10k',      text: 'Reach $10,000 total revenue', reward: 1000 },
  { id: 'staff4',      text: 'Have 4 employees on the payroll', reward: 800 },
  { id: 'rep4',        text: 'Reach a 4★ reputation', reward: 1200 },
  { id: 'day3k',       text: 'Earn $3,000 in a single day', reward: 1500 },
  { id: 'level8',      text: 'Reach store level 8', reward: 2500 },
  { id: 'rev100k',     text: 'Reach $100,000 total revenue — top of the market!', reward: 5000 },
];

export const FIRST_NAMES = ['Ava', 'Ben', 'Chloe', 'Dan', 'Ella', 'Finn', 'Gina', 'Hugo', 'Ivy', 'Jack', 'Kira', 'Leo', 'Maya', 'Noah', 'Olive', 'Pablo', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Umar', 'Vera', 'Wes', 'Xena', 'Yusuf', 'Zoe', 'Amir', 'Bella', 'Carlos', 'Dina', 'Eli', 'Farah', 'Gus', 'Hana', 'Igor', 'Jade', 'Kofi', 'Lena', 'Milo', 'Nina', 'Omar', 'Priya', 'Rami', 'Sofia', 'Theo', 'Uma', 'Viktor', 'Yara'];
export const LAST_NAMES = ['Baker', 'Cohen', 'Diaz', 'Evans', 'Fischer', 'Garcia', 'Hughes', 'Ito', 'Jensen', 'Kim', 'Levi', 'Moreau', 'Nakamura', 'Okafor', 'Patel', 'Rossi', 'Silva', 'Tanaka', 'Usman', 'Varga', 'Weber', 'Young', 'Zhang', 'Novak', 'Haddad', 'Lindqvist', 'Mendes', 'Peretz'];

export const EVENT_TYPES = {
  rush:       { name: 'Customer Rush!',        icon: '🏃', desc: 'A bus tour just arrived. Customers are pouring in!' },
  delay:      { name: 'Supplier Delays',       icon: '🐢', desc: 'Traffic jam on the highway. Deliveries take twice as long today.' },
  breakdown:  { name: 'Equipment Breakdown',   icon: '🔥', desc: 'A cooler just broke down! Repair it before the food spoils.' },
  shortage:   { name: 'Product Shortage',      icon: '🚫', desc: 'Suppliers have run out of a product today.' },
  holiday:    { name: 'Holiday Shopping',      icon: '🎄', desc: 'It\'s a holiday! Bigger baskets and more shoppers.' },
  vip:        { name: 'VIP Shopper',           icon: '🕶️', desc: 'A famous food blogger is looking for something special.' },
  absence:    { name: 'Staff Absence',         icon: '🤒', desc: 'An employee called in sick today.' },
  sale:       { name: 'Flash Sale Opportunity',icon: '🏷️', desc: 'Run a store-wide 15% discount to attract a crowd?' },
  inspector:  { name: 'Health Inspector',      icon: '🧐', desc: 'An inspector will check cleanliness at 15:00!' },
  heatwave:   { name: 'Heatwave',              icon: '☀️', desc: 'Everyone wants cold drinks and ice cream!' },
  influencer: { name: 'Viral Video',           icon: '📱', desc: 'Your store went viral! Reputation boost and extra visitors.' },
  pigeon:     { name: 'A Pigeon Got In',       icon: '🐦', desc: 'A pigeon is making a mess. Clean up the droppings!' },
};

// ------------------------------------------------------------------ realistic shelving
// Real-world package sizes (metres): width, height, depth. `stack` = how many layers fit on top of each other.
export const SHAPE_DIMS = {
  box: { w: 0.19, h: 0.28, d: 0.07, stack: 1 }, flatbox: { w: 0.2, h: 0.13, d: 0.12, stack: 2 }, bag: { w: 0.17, h: 0.25, d: 0.08, stack: 1 },
  can: { w: 0.075, h: 0.12, d: 0.075, stack: 2 }, bottle: { w: 0.08, h: 0.29, d: 0.08, stack: 1 }, jar: { w: 0.09, h: 0.14, d: 0.09, stack: 2 },
  carton: { w: 0.09, h: 0.24, d: 0.09, stack: 1 }, tub: { w: 0.1, h: 0.08, d: 0.1, stack: 3 }, sphere: { w: 0.085, h: 0.085, d: 0.085, stack: 2 },
  long: { w: 0.19, h: 0.045, d: 0.06, stack: 3 }, slab: { w: 0.2, h: 0.04, d: 0.15, stack: 1 }, wedge: { w: 0.14, h: 0.08, d: 0.12, stack: 1 },
  // household: a plastic-wrapped toilet roll pack, a handled jug, a squeeze bottle, a big gusseted powder bag
  pack: { w: 0.3, h: 0.27, d: 0.2, stack: 1 }, jug: { w: 0.15, h: 0.28, d: 0.11, stack: 1 }, squeeze: { w: 0.075, h: 0.21, d: 0.045, stack: 1 },
  pouch: { w: 0.24, h: 0.32, d: 0.1, stack: 1 },
  // bakery (sold unwrapped): a loaf, a round roll, a croissant, a baguette
  loaf: { w: 0.21, h: 0.1, d: 0.11, stack: 2 }, bun: { w: 0.095, h: 0.055, d: 0.095, stack: 2 }, crescent: { w: 0.14, h: 0.05, d: 0.085, stack: 2 }, stick: { w: 0.4, h: 0.055, d: 0.065, stack: 3 },
};
// Product sections of each fixture in local coordinates (centred, customer side = +z):
// x0..x1 across, y = floor of the section, zf = front edge, depth, h = clear height.
export function slotRegions(type) {
  const tiers = (ys, xs, zf, depth, h) => ys.flatMap(y => xs.map(([x0, x1]) => ({ x0, x1, y, zf, depth, h })));
  switch (type) {
    case 'shelf': return tiers([0.16, 0.54, 0.92, 1.3], [[-0.95, -0.03], [0.03, 0.95]], 0.26, 0.5, 0.34);
    case 'shelf_large': return tiers([0.16, 0.51, 0.86, 1.21, 1.56], [[-1.46, -0.54], [-0.46, 0.46], [0.54, 1.46]], 0.26, 0.5, 0.31);
    case 'bakery': return tiers([0.42, 0.82, 1.22], [[-0.95, -0.03], [0.03, 0.95]], 0.3, 0.52, 0.3);
    case 'endcap': return tiers([0.16, 0.49, 0.82, 1.15], [[-0.43, 0.43]], 0.24, 0.45, 0.29);
    case 'fridge': case 'freezer_upright': return tiers([0.18, 0.52, 0.86, 1.2, 1.54], [[-0.9, -0.03], [0.03, 0.9]], 0.3, 0.5, 0.3);
    case 'fridge_large': return tiers([0.2, 0.54, 0.88, 1.22, 1.56], [[-1.45, -0.52], [-0.45, 0.45], [0.52, 1.45]], 0.32, 0.52, 0.3);
    case 'freezer': return [[-0.92, -0.03, 0.4], [0.03, 0.92, 0.4], [-0.92, -0.03, -0.02], [0.03, 0.92, -0.02]].map(([x0, x1, zf]) => ({ x0, x1, y: 0.32, zf, depth: 0.37, h: 0.4 }));
    case 'produce': return [[-0.95, -0.05, 0.42, 0.4], [0.05, 0.95, 0.42, 0.4], [-0.95, -0.05, 0.72, 0.02], [0.05, 0.95, 0.72, 0.02]].map(([x0, x1, y, zf]) => ({ x0, x1, y, zf, depth: 0.32, h: 0.2, pile: true }));
    case 'butcher': case 'deli': return [[-1.45, -0.75], [-0.72, -0.02], [0.02, 0.72], [0.75, 1.45]].map(([x0, x1]) => ({ x0, x1, y: 0.62, zf: 1.27, depth: 0.5, h: 0.1 }));
  }
  return [];
}
// How many units of a product fit in one section of a fixture: depends on the package size.
const capCache = new Map();
export function slotCap(type, pid) {
  const k = type + ':' + pid;
  if (capCache.has(k)) return capCache.get(k);
  const def = FURNITURE[type], p = PRODUCT_MAP[pid], r = slotRegions(type)[0];
  let cap = def.cap || 12;
  if (p && r) {
    const d = SHAPE_DIMS[p.shape] || SHAPE_DIMS.box;
    const cols = Math.max(1, Math.floor((r.x1 - r.x0) / (d.w + 0.012)));
    const rows = Math.max(1, Math.floor(r.depth / (d.d + 0.01)));
    const layers = Math.max(1, Math.min(d.stack, Math.floor(r.h / (d.h + 0.005))));
    cap = Math.max(4, Math.min(def.cap || 60, cols * rows * layers));
  }
  capCache.set(k, cap);
  return cap;
}

// the shopping-cart bay: outside, on the sidewalk to the right of the entrance
export function cartBay(doorX, d) { return { x: doorX + 3.7, z: d + 1.3 }; }
export const CART_BOXES = 4; // boxes a player can move in a shopping cart
// promotions: a product on promotion sells 20% cheaper and shoppers pick it far more often; a few at a time
export const PROMO_OFF = 0.2, PROMO_MAX = 4;
export function shelfPrice(w, pid) { const p = PRODUCT_MAP[pid]; return Math.round((w.prices[pid] ?? p.price) * (w.saleActive ? 0.85 : 1) * ((w.promos || []).includes(pid) ? 1 - PROMO_OFF : 1) * 100) / 100; }
export function productsForCat(cat) { return PRODUCTS.filter(p => p.cat === cat); }
export function fmtMoney(v) {
  const s = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-$' : '$') + s;
}
export function fmtTime(min) {
  const h = Math.floor(min / 60), m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
