/**
 * Upsert cooking recipes + recipe_* scroll items from the recipe sections of
 * seeds.txt (expanded into concrete fixed-ingredient recipes).
 *
 * Usage:
 *   npm run seed:cooking
 *   npm run seed:cooking -- --generate-images
 *   npm run seed:cooking-images
 *   npm run seed:cooking-images -- --concurrency=12
 *
 * Optional --generate-images fills missing food/ingredient art via OpenAI
 * in parallel (default concurrency 12). Skips junk single-letter itemTypes.
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { Recipe } from '../models/Recipe.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';
import { ensureCookingRecipeItemDef, defaultRecipeItemType } from '../services/CookingRecipeItems.js';

const log = createLogger('SeedCooking');

const STYLE_FRAGMENT =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: front-facing view, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image.`;

type Group =
  | 'processing'
  | 'baking'
  | 'sandwich'
  | 'bakery'
  | 'salad'
  | 'soup'
  | 'dessert'
  | 'drink'
  | 'seafood';

interface CookDef {
  recipeId: string;
  label: string;
  resultItemType: string;
  ingredients: { itemType: string; qty: number }[];
  difficulty?: number;
  group: Group;
  sortOrder: number;
  resultCategory?: 'food' | 'ingredient';
  hunger?: number;
  happiness?: number;
}

const FRUITS = [
  'apple',
  'peach',
  'pear',
  'banana',
  'orange',
  'lemon',
  'lime',
  'dragon_fruit',
  'cherries',
  'grapes',
  'avacado',
  'watermelon',
  'melon',
  'strawberry',
  'blueberry',
  'raspberry',
  'blackberry',
  'crystal_berry',
  'aurora_berry',
  'frost_berry',
  'starfruit',
  'sunfruit',
  'spirit_melon',
  'dream_fruit',
] as const;

const BERRIES = [
  'strawberry',
  'blueberry',
  'raspberry',
  'blackberry',
  'crystal_berry',
  'aurora_berry',
  'frost_berry',
] as const;

const HERBS = [
  'basil',
  'mint',
  'rosemary',
  'thyme',
  'oregano',
  'sage',
  'parsley',
  'dill',
  'chive',
  'lavender',
  'chamomile',
  'cilantro',
  'tarragon',
  'bay',
  'fennel',
] as const;

function titleCase(itemType: string): string {
  return itemType
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildRecipes(): CookDef[] {
  const recipes: CookDef[] = [];
  let sort = 100;

  const add = (partial: Omit<CookDef, 'sortOrder'> & { sortOrder?: number }) => {
    recipes.push({
      difficulty: 1,
      resultCategory: 'food',
      hunger: 12,
      happiness: 6,
      ...partial,
      sortOrder: partial.sortOrder ?? sort,
    });
    sort += 1;
  };

  // ── Processing ──────────────────────────────────────────────────────────
  sort = 100;
  add({
    recipeId: 'flour',
    label: 'Flour',
    resultItemType: 'flour',
    ingredients: [{ itemType: 'wheat', qty: 2 }],
    group: 'processing',
    resultCategory: 'ingredient',
  });
  add({
    recipeId: 'cornmeal',
    label: 'Cornmeal',
    resultItemType: 'cornmeal',
    ingredients: [{ itemType: 'corn', qty: 2 }],
    group: 'processing',
    resultCategory: 'ingredient',
  });
  add({
    recipeId: 'sugar',
    label: 'Sugar',
    resultItemType: 'sugar',
    ingredients: [{ itemType: 'sugar_cane', qty: 3 }],
    group: 'processing',
    resultCategory: 'ingredient',
  });
  add({
    recipeId: 'butter',
    label: 'Butter',
    resultItemType: 'butter',
    ingredients: [{ itemType: 'milk', qty: 1 }],
    group: 'processing',
    resultCategory: 'ingredient',
  });
  add({
    recipeId: 'cheese',
    label: 'Cheese',
    resultItemType: 'cheese',
    ingredients: [{ itemType: 'milk', qty: 2 }],
    group: 'processing',
  });
  add({
    recipeId: 'yogurt',
    label: 'Yogurt',
    resultItemType: 'yogurt',
    ingredients: [{ itemType: 'milk', qty: 1 }],
    group: 'processing',
  });
  add({
    recipeId: 'tomato_sauce',
    label: 'Tomato Sauce',
    resultItemType: 'tomato_sauce',
    ingredients: [{ itemType: 'tomato', qty: 3 }],
    group: 'processing',
    resultCategory: 'ingredient',
  });
  add({
    recipeId: 'mashed_potato',
    label: 'Mashed Potato',
    resultItemType: 'mashed_potato',
    ingredients: [{ itemType: 'potato', qty: 2 }],
    group: 'processing',
  });
  add({
    recipeId: 'vegetable_stock',
    label: 'Vegetable Stock',
    resultItemType: 'vegetable_stock',
    ingredients: [
      { itemType: 'carrot', qty: 1 },
      { itemType: 'onion', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'processing',
    resultCategory: 'ingredient',
  });
  add({
    recipeId: 'apple_jam',
    label: 'Apple Jam',
    resultItemType: 'apple_jam',
    ingredients: [{ itemType: 'apple', qty: 3 }],
    group: 'processing',
  });
  for (const fruit of FRUITS) {
    if (fruit === 'apple') continue;
    add({
      recipeId: `${fruit}_jam`,
      label: `${titleCase(fruit)} Jam`,
      resultItemType: `${fruit}_jam`,
      ingredients: [{ itemType: fruit, qty: 3 }],
      group: 'processing',
    });
  }
  for (const berry of BERRIES) {
    add({
      recipeId: `${berry}_berry_jam`,
      label: `${titleCase(berry)} Berry Jam`,
      resultItemType: `${berry}_berry_jam`,
      ingredients: [{ itemType: berry, qty: 3 }],
      group: 'processing',
    });
  }
  add({
    recipeId: 'pickles',
    label: 'Pickles',
    resultItemType: 'pickles',
    ingredients: [
      { itemType: 'cucumber', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'processing',
  });
  add({
    recipeId: 'popcorn',
    label: 'Popcorn',
    resultItemType: 'popcorn',
    ingredients: [{ itemType: 'corn', qty: 1 }],
    group: 'processing',
  });
  for (const herb of HERBS) {
    add({
      recipeId: `dried_${herb}`,
      label: `Dried ${titleCase(herb)}`,
      resultItemType: `dried_${herb}`,
      ingredients: [{ itemType: herb, qty: 1 }],
      group: 'processing',
      resultCategory: 'ingredient',
    });
  }

  // Keep sliced_carrots from existing ladder
  add({
    recipeId: 'sliced_carrots',
    label: 'Sliced Carrots',
    resultItemType: 'sliced_carrots',
    ingredients: [{ itemType: 'carrot', qty: 2 }],
    group: 'processing',
  });
  add({
    recipeId: 'sliced_cucumber',
    label: 'Sliced Cucumber',
    resultItemType: 'sliced_cucumber',
    ingredients: [{ itemType: 'cucumber', qty: 1 }],
    group: 'processing',
  });
  add({
    recipeId: 'sliced_watermelon',
    label: 'Sliced Watermelon',
    resultItemType: 'sliced_watermelon',
    ingredients: [{ itemType: 'watermelon', qty: 1 }],
    group: 'processing',
  });

  // ── Baking ──────────────────────────────────────────────────────────────
  sort = 200;
  add({
    recipeId: 'bread_dough',
    label: 'Bread Dough',
    resultItemType: 'bread_dough',
    ingredients: [
      { itemType: 'flour', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'baking',
    resultCategory: 'ingredient',
  });
  add({
    recipeId: 'bread',
    label: 'Bread',
    resultItemType: 'bread',
    ingredients: [{ itemType: 'bread_dough', qty: 1 }],
    group: 'baking',
    difficulty: 2,
  });
  add({
    recipeId: 'flatbread',
    label: 'Flatbread',
    resultItemType: 'flatbread',
    ingredients: [
      { itemType: 'flour', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'baking',
  });
  add({
    recipeId: 'sweet_bread',
    label: 'Sweet Bread',
    resultItemType: 'sweet_bread',
    ingredients: [
      { itemType: 'bread', qty: 1 },
      { itemType: 'sugar', qty: 1 },
    ],
    group: 'baking',
  });
  add({
    recipeId: 'toast',
    label: 'Toast',
    resultItemType: 'toast',
    ingredients: [{ itemType: 'bread', qty: 1 }],
    group: 'baking',
  });
  add({
    recipeId: 'bread_roll',
    label: 'Bread Roll',
    resultItemType: 'bread_roll',
    ingredients: [{ itemType: 'bread_dough', qty: 1 }],
    group: 'baking',
  });
  add({
    recipeId: 'pie_crust',
    label: 'Pie Crust',
    resultItemType: 'pie_crust',
    ingredients: [
      { itemType: 'flour', qty: 1 },
      { itemType: 'butter', qty: 1 },
    ],
    group: 'baking',
    resultCategory: 'ingredient',
  });
  add({
    recipeId: 'cake_batter',
    label: 'Cake Batter',
    resultItemType: 'cake_batter',
    ingredients: [
      { itemType: 'flour', qty: 1 },
      { itemType: 'butter', qty: 1 },
      { itemType: 'sugar', qty: 1 },
    ],
    group: 'baking',
    resultCategory: 'ingredient',
  });

  // ── Sandwiches ──────────────────────────────────────────────────────────
  sort = 300;
  const sandwiches: [string, string, string][] = [
    ['garden_sandwich', 'Garden Sandwich', 'lettuce'],
    ['tomato_sandwich', 'Tomato Sandwich', 'tomato'],
    ['cheese_sandwich', 'Cheese Sandwich', 'cheese'],
    ['apple_sandwich', 'Apple Sandwich', 'apple'],
    ['cucumber_sandwich', 'Cucumber Sandwich', 'cucumber'],
    ['egg_sandwich', 'Egg Sandwich', 'white_egg'],
    ['pumpkin_sandwich', 'Pumpkin Sandwich', 'pumpkin'],
  ];
  for (const [id, label, filling] of sandwiches) {
    add({
      recipeId: id,
      label,
      resultItemType: id,
      ingredients: [
        { itemType: 'bread', qty: 1 },
        { itemType: filling, qty: 1 },
      ],
      group: 'sandwich',
      hunger: 18,
    });
  }

  // ── Bakery breads ───────────────────────────────────────────────────────
  sort = 400;
  const bakery: [string, string, string][] = [
    ['apple_bread', 'Apple Bread', 'apple'],
    ['pumpkin_bread', 'Pumpkin Bread', 'pumpkin'],
    ['blueberry_bread', 'Blueberry Bread', 'blueberry'],
    ['banana_bread', 'Banana Bread', 'banana'],
    ['strawberry_bread', 'Berry Bread', 'strawberry'],
    ['garlic_bread', 'Garlic Bread', 'garlic'],
    ['herb_bread', 'Herb Bread', 'parsley'],
    ['cinnamon_bread', 'Cinnamon Bread', 'cinnamon'],
    ['honey_bread', 'Honey Bread', 'honey'],
    ['lemon_bread', 'Lemon Bread', 'lemon'],
  ];
  for (const [id, label, extra] of bakery) {
    add({
      recipeId: id,
      label,
      resultItemType: id,
      ingredients: [
        { itemType: 'bread', qty: 1 },
        { itemType: extra, qty: 1 },
      ],
      group: 'bakery',
      hunger: 16,
    });
  }

  // ── Salads ──────────────────────────────────────────────────────────────
  sort = 500;
  add({
    recipeId: 'garden_salad',
    label: 'Garden Salad',
    resultItemType: 'garden_salad',
    ingredients: [
      { itemType: 'lettuce', qty: 1 },
      { itemType: 'tomato', qty: 1 },
    ],
    group: 'salad',
  });
  add({
    recipeId: 'fresh_salad',
    label: 'Fresh Salad',
    resultItemType: 'fresh_salad',
    ingredients: [
      { itemType: 'lettuce', qty: 1 },
      { itemType: 'carrot', qty: 1 },
    ],
    group: 'salad',
  });
  add({
    recipeId: 'herb_salad',
    label: 'Herb Salad',
    resultItemType: 'herb_salad',
    ingredients: [
      { itemType: 'lettuce', qty: 1 },
      { itemType: 'basil', qty: 1 },
    ],
    group: 'salad',
  });
  add({
    recipeId: 'potato_salad',
    label: 'Potato Salad',
    resultItemType: 'potato_salad',
    ingredients: [
      { itemType: 'potato', qty: 1 },
      { itemType: 'dill', qty: 1 },
    ],
    group: 'salad',
  });
  add({
    recipeId: 'fruit_salad',
    label: 'Fruit Salad',
    resultItemType: 'fruit_salad',
    ingredients: [
      { itemType: 'apple', qty: 1 },
      { itemType: 'orange', qty: 1 },
      { itemType: 'banana', qty: 1 },
    ],
    group: 'salad',
  });
  add({
    recipeId: 'berry_bowl',
    label: 'Berry Bowl',
    resultItemType: 'berry_bowl',
    ingredients: [
      { itemType: 'strawberry', qty: 1 },
      { itemType: 'blueberry', qty: 1 },
      { itemType: 'raspberry', qty: 1 },
    ],
    group: 'salad',
  });
  add({
    recipeId: 'summer_salad',
    label: 'Summer Salad',
    resultItemType: 'summer_salad',
    ingredients: [
      { itemType: 'corn', qty: 1 },
      { itemType: 'tomato', qty: 1 },
      { itemType: 'lettuce', qty: 1 },
    ],
    group: 'salad',
  });
  add({
    recipeId: 'farmer_salad',
    label: 'Farmer Salad',
    resultItemType: 'farmer_salad',
    ingredients: [
      { itemType: 'carrot', qty: 1 },
      { itemType: 'radish', qty: 1 },
      { itemType: 'lettuce', qty: 1 },
    ],
    group: 'salad',
  });

  // ── Soups ───────────────────────────────────────────────────────────────
  sort = 600;
  const soups: [string, string, string][] = [
    ['tomato_soup', 'Tomato Soup', 'tomato'],
    ['potato_soup', 'Potato Soup', 'potato'],
    ['pumpkin_soup', 'Pumpkin Soup', 'pumpkin'],
    ['mushroom_soup', 'Mushroom Soup', 'brown_mushroom'],
    ['onion_soup', 'Onion Soup', 'onion'],
    ['broccoli_soup', 'Broccoli Soup', 'broccoli'],
    ['corn_chowder', 'Corn Chowder', 'corn'],
    ['herb_soup', 'Herb Soup', 'basil'],
  ];
  for (const [id, label, veg] of soups) {
    add({
      recipeId: id,
      label,
      resultItemType: id,
      ingredients: [
        { itemType: veg, qty: 2 },
        { itemType: 'water', qty: 1 },
      ],
      group: 'soup',
      difficulty: 2,
      hunger: 20,
    });
  }
  add({
    recipeId: 'vegetable_soup',
    label: 'Vegetable Soup',
    resultItemType: 'vegetable_soup',
    ingredients: [
      { itemType: 'carrot', qty: 1 },
      { itemType: 'potato', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'soup',
    difficulty: 2,
    hunger: 22,
  });
  add({
    recipeId: 'cream_soup',
    label: 'Cream Soup',
    resultItemType: 'cream_soup',
    ingredients: [
      { itemType: 'milk', qty: 1 },
      { itemType: 'potato', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'soup',
    difficulty: 2,
    hunger: 22,
  });

  // ── Desserts ────────────────────────────────────────────────────────────
  sort = 700;
  const pies: [string, string, string][] = [
    ['apple_pie', 'Apple Pie', 'apple'],
    ['cherry_pie', 'Cherry Pie', 'cherries'],
    ['peach_pie', 'Peach Pie', 'peach'],
    ['blueberry_pie', 'Blueberry Pie', 'blueberry'],
    ['strawberry_pie', 'Strawberry Pie', 'strawberry'],
  ];
  for (const [id, label, fruit] of pies) {
    add({
      recipeId: id,
      label,
      resultItemType: id,
      ingredients: [
        { itemType: fruit, qty: 1 },
        { itemType: 'sugar', qty: 1 },
        { itemType: 'pie_crust', qty: 1 },
      ],
      group: 'dessert',
      difficulty: 3,
      hunger: 24,
    });
  }
  // Early-game friendly: no crust required (starter side quest)
  add({
    recipeId: 'pumpkin_pie',
    label: 'Pumpkin Pie',
    resultItemType: 'pumpkin_pie',
    ingredients: [
      { itemType: 'pumpkin', qty: 1 },
      { itemType: 'sugar', qty: 1 },
    ],
    group: 'dessert',
    difficulty: 2,
    hunger: 22,
  });

  add({
    recipeId: 'berry_tart',
    label: 'Berry Tart',
    resultItemType: 'berry_tart',
    ingredients: [
      { itemType: 'strawberry', qty: 1 },
      { itemType: 'blueberry', qty: 1 },
      { itemType: 'pie_crust', qty: 1 },
    ],
    group: 'dessert',
    difficulty: 3,
  });
  add({
    recipeId: 'lemon_tart',
    label: 'Lemon Tart',
    resultItemType: 'lemon_tart',
    ingredients: [
      { itemType: 'lemon', qty: 1 },
      { itemType: 'sugar', qty: 1 },
      { itemType: 'pie_crust', qty: 1 },
    ],
    group: 'dessert',
    difficulty: 3,
  });
  add({
    recipeId: 'fruit_cake',
    label: 'Fruit Cake',
    resultItemType: 'fruit_cake',
    ingredients: [
      { itemType: 'cake_batter', qty: 1 },
      { itemType: 'apple', qty: 1 },
      { itemType: 'cherries', qty: 1 },
    ],
    group: 'dessert',
    difficulty: 3,
  });
  add({
    recipeId: 'carrot_cake',
    label: 'Carrot Cake',
    resultItemType: 'carrot_cake',
    ingredients: [
      { itemType: 'cake_batter', qty: 1 },
      { itemType: 'carrot', qty: 2 },
    ],
    group: 'dessert',
    difficulty: 3,
  });
  add({
    recipeId: 'cheesecake',
    label: 'Cheesecake',
    resultItemType: 'cheesecake',
    ingredients: [
      { itemType: 'cheese', qty: 1 },
      { itemType: 'sugar', qty: 1 },
      { itemType: 'pie_crust', qty: 1 },
    ],
    group: 'dessert',
    difficulty: 3,
  });
  add({
    recipeId: 'berry_cheesecake',
    label: 'Berry Cheesecake',
    resultItemType: 'berry_cheesecake',
    ingredients: [
      { itemType: 'cheese', qty: 1 },
      { itemType: 'strawberry', qty: 1 },
      { itemType: 'pie_crust', qty: 1 },
    ],
    group: 'dessert',
    difficulty: 3,
  });
  add({
    recipeId: 'apple_crumble',
    label: 'Apple Crumble',
    resultItemType: 'apple_crumble',
    ingredients: [
      { itemType: 'apple', qty: 2 },
      { itemType: 'flour', qty: 1 },
      { itemType: 'sugar', qty: 1 },
    ],
    group: 'dessert',
    difficulty: 2,
  });
  add({
    recipeId: 'jam_cookies',
    label: 'Jam Cookies',
    resultItemType: 'jam_cookies',
    ingredients: [
      { itemType: 'flour', qty: 1 },
      { itemType: 'apple_jam', qty: 1 },
      { itemType: 'sugar', qty: 1 },
    ],
    group: 'dessert',
    difficulty: 2,
  });
  add({
    recipeId: 'honey_cookies',
    label: 'Honey Cookies',
    resultItemType: 'honey_cookies',
    ingredients: [
      { itemType: 'flour', qty: 1 },
      { itemType: 'honey', qty: 1 },
      { itemType: 'sugar', qty: 1 },
    ],
    group: 'dessert',
    difficulty: 2,
  });

  // ── Drinks ──────────────────────────────────────────────────────────────
  sort = 800;
  add({
    recipeId: 'apple_juice',
    label: 'Apple Juice',
    resultItemType: 'apple_juice',
    ingredients: [{ itemType: 'apple', qty: 2 }],
    group: 'drink',
  });
  add({
    recipeId: 'orange_juice',
    label: 'Orange Juice',
    resultItemType: 'orange_juice',
    ingredients: [
      { itemType: 'orange', qty: 1 },
      { itemType: 'sugar', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'lemonade',
    label: 'Lemonade',
    resultItemType: 'lemonade',
    ingredients: [
      { itemType: 'lemon', qty: 1 },
      { itemType: 'sugar', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'berry_smoothie',
    label: 'Berry Smoothie',
    resultItemType: 'berry_smoothie',
    ingredients: [
      { itemType: 'strawberry', qty: 1 },
      { itemType: 'blueberry', qty: 1 },
      { itemType: 'milk', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'strawberry_smoothie',
    label: 'Strawberry Smoothie',
    resultItemType: 'strawberry_smoothie',
    ingredients: [
      { itemType: 'strawberry', qty: 2 },
      { itemType: 'milk', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'peach_smoothie',
    label: 'Peach Smoothie',
    resultItemType: 'peach_smoothie',
    ingredients: [
      { itemType: 'peach', qty: 2 },
      { itemType: 'milk', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'herbal_tea',
    label: 'Herbal Tea',
    resultItemType: 'herbal_tea',
    ingredients: [
      { itemType: 'basil', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'mint_tea',
    label: 'Mint Tea',
    resultItemType: 'mint_tea',
    ingredients: [
      { itemType: 'mint', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'chamomile_tea',
    label: 'Chamomile Tea',
    resultItemType: 'chamomile_tea',
    ingredients: [
      { itemType: 'chamomile', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'lavender_tea',
    label: 'Lavender Tea',
    resultItemType: 'lavender_tea',
    ingredients: [
      { itemType: 'lavender', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'mushroom_tea',
    label: 'Mushroom Tea',
    resultItemType: 'mushroom_tea',
    ingredients: [
      { itemType: 'brown_mushroom', qty: 1 },
      { itemType: 'water', qty: 1 },
    ],
    group: 'drink',
  });
  add({
    recipeId: 'fruit_punch',
    label: 'Fruit Punch',
    resultItemType: 'fruit_punch',
    ingredients: [
      { itemType: 'orange', qty: 1 },
      { itemType: 'apple', qty: 1 },
      { itemType: 'sugar', qty: 1 },
    ],
    group: 'drink',
  });

  // Seafood keepers
  sort = 900;
  add({
    recipeId: 'cooked_trout',
    label: 'Cooked Trout',
    resultItemType: 'cooked_trout',
    ingredients: [{ itemType: 'trout', qty: 1 }],
    group: 'seafood',
    hunger: 20,
  });

  return recipes;
}

/** Pantry staples not grown as crops but needed by recipes. */
const PANTRY_ITEMS: {
  itemType: string;
  label: string;
  category: 'food' | 'ingredient';
  hunger?: number;
  happiness?: number;
}[] = [
  { itemType: 'milk', label: 'Milk', category: 'ingredient' },
  { itemType: 'butter', label: 'Butter', category: 'ingredient' },
  { itemType: 'honey', label: 'Honey', category: 'ingredient' },
  { itemType: 'cinnamon', label: 'Cinnamon', category: 'ingredient' },
  { itemType: 'sugar', label: 'Sugar', category: 'ingredient' },
  { itemType: 'flour', label: 'Flour', category: 'ingredient' },
  { itemType: 'bread_dough', label: 'Bread Dough', category: 'ingredient' },
  { itemType: 'pie_crust', label: 'Pie Crust', category: 'ingredient' },
  { itemType: 'cake_batter', label: 'Cake Batter', category: 'ingredient' },
  { itemType: 'cornmeal', label: 'Cornmeal', category: 'ingredient' },
  { itemType: 'vegetable_stock', label: 'Vegetable Stock', category: 'ingredient' },
  { itemType: 'yogurt', label: 'Yogurt', category: 'food', hunger: 10, happiness: 5 },
  { itemType: 'cheese', label: 'Cheese', category: 'food', hunger: 12, happiness: 6 },
  { itemType: 'strange_stew', label: 'Strange Stew', category: 'food', hunger: 5, happiness: 1 },
];

async function ensureItem(def: {
  itemType: string;
  label: string;
  category: 'food' | 'ingredient';
  hunger?: number;
  happiness?: number;
}): Promise<void> {
  const existing = await GameItemDef.findOne({ itemType: def.itemType });
  if (existing) {
    if (def.hunger != null && existing.foodHunger == null) {
      existing.foodHunger = def.hunger;
      existing.foodHappiness = def.happiness ?? 4;
      await existing.save();
    }
    return;
  }
  await GameItemDef.create({
    itemType: def.itemType,
    label: def.label,
    emoji: '🍽️',
    color: '#E8C4A8',
    category: def.category,
    placeable: false,
    cols: 1,
    rows: 1,
    sellable: true,
    sellPrice: 15,
    harvestYield: [],
    foodHunger: def.hunger,
    foodHappiness: def.happiness,
  });
}

async function ensureResultItem(recipe: CookDef): Promise<void> {
  await ensureItem({
    itemType: recipe.resultItemType,
    label: recipe.label,
    category: recipe.resultCategory ?? 'food',
    hunger: recipe.hunger,
    happiness: recipe.happiness,
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function cookImagePrompt(label: string, category: 'food' | 'ingredient'): string {
  const subject =
    category === 'ingredient'
      ? `a single cooking ingredient: ${label.toLowerCase()}, cozy farming game pantry item icon`
      : `a single plated cooked dish: ${label.toLowerCase()}, cozy farming game food icon`;
  return `${subject}. ${STYLE_FRAGMENT}`;
}

async function generateCookImage(
  itemType: string,
  label: string,
  category: 'food' | 'ingredient',
): Promise<string> {
  const prompt = cookImagePrompt(label, category);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const base64DataUri = await openAIService.generateImageBase64(prompt, {
        model: 'gpt-image-1',
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
      });
      return await storageService.uploadBase64(base64DataUri, `game-items/${itemType}`);
    } catch (err) {
      lastErr = err;
      log.warn({ err, itemType, attempt }, 'Image generation failed; retrying');
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const generateImages = process.argv.includes('--generate-images');
  const concurrencyArg = [...process.argv].reverse().find((a) => a.startsWith('--concurrency='));
  const concurrency = Math.max(
    1,
    Math.min(24, Number(concurrencyArg?.split('=')[1] ?? 12) || 12),
  );

  await connectDatabase();
  const recipes = buildRecipes();
  log.info({ count: recipes.length, generateImages, concurrency }, 'Cooking recipes to upsert');

  for (const pantry of PANTRY_ITEMS) {
    await ensureItem(pantry);
  }

  // Deduplicate by recipeId (berry jam expansions may overlap fruit jam)
  const seen = new Set<string>();
  const unique = recipes.filter((r) => {
    if (seen.has(r.recipeId)) return false;
    seen.add(r.recipeId);
    return true;
  });

  let created = 0;
  let updated = 0;
  for (const r of unique) {
    if (r.ingredients.length < 1 || r.ingredients.length > 4) {
      log.warn({ recipeId: r.recipeId, n: r.ingredients.length }, 'Skipping invalid ingredient count');
      continue;
    }
    await ensureResultItem(r);
    const recipeItemType = defaultRecipeItemType(r.recipeId);
    const existing = await Recipe.findOne({ recipeId: r.recipeId });
    const payload = {
      label: r.label,
      resultItemType: r.resultItemType,
      resultQty: 1,
      ingredients: r.ingredients,
      difficulty: r.difficulty ?? 1,
      recipeType: 'cooking' as const,
      recipeItemType,
      group: r.group,
      sortOrder: r.sortOrder,
    };
    if (!existing) {
      await Recipe.create({ recipeId: r.recipeId, ...payload });
      created += 1;
    } else {
      existing.label = payload.label;
      existing.resultItemType = payload.resultItemType;
      existing.resultQty = payload.resultQty;
      existing.ingredients = payload.ingredients;
      existing.difficulty = payload.difficulty;
      existing.recipeType = 'cooking';
      existing.recipeItemType = recipeItemType;
      existing.group = payload.group;
      existing.sortOrder = payload.sortOrder;
      await existing.save();
      updated += 1;
    }
    await ensureCookingRecipeItemDef({
      recipeId: r.recipeId,
      label: r.label,
      recipeItemType,
    });
  }

  log.info({ created, updated, total: unique.length }, 'Cooking recipes upserted');

  if (generateImages) {
    const needsArt = await GameItemDef.find({
      category: { $in: ['food', 'ingredient'] },
      itemType: { $nin: ['c'] },
      $expr: { $gte: [{ $strLenCP: '$itemType' }, 2] },
      $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: '' }],
    }).select('itemType label category');

    log.info({ count: needsArt.length, concurrency }, 'Generating missing food/ingredient images');

    let ok = 0;
    let failed = 0;
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < needsArt.length) {
        const index = cursor;
        cursor += 1;
        const item = needsArt[index];
        const category = (item.category === 'ingredient' ? 'ingredient' : 'food') as
          | 'food'
          | 'ingredient';
        try {
          const imageUrl = await generateCookImage(item.itemType, item.label, category);
          item.imageUrl = imageUrl;
          await item.save();
          ok += 1;
          log.info(
            {
              itemType: item.itemType,
              category,
              done: ok,
              left: needsArt.length - ok - failed,
            },
            'Cook image saved',
          );
        } catch (err) {
          failed += 1;
          log.error({ err, itemType: item.itemType }, 'Cook image generation failed');
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(1, needsArt.length)) }, () => worker()),
    );
    log.info({ ok, failed }, 'Image generation finished');
  }

  await disconnectDatabase();
  log.info('Done');
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
