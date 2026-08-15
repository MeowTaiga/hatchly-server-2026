/**
 * Tile footprint (cols × rows) for crafted furniture / clutter.
 * Used by seedCraftingFromTxt and patchCraftedItemSizes.
 *
 * Grown trees are 4×4 — rugs and yard structures can meet or exceed that.
 */
export type CraftSizeSection = 'stone' | 'primitive' | 'stick' | 'tools' | 'material' | 'furniture';

export function craftItemSize(
  label: string,
  section: CraftSizeSection,
): { cols: number; rows: number } {
  if (section === 'tools' || section === 'material') return { cols: 1, rows: 1 };

  const l = label.toLowerCase();

  // Floor rugs — larger than a grown tree so they read as room-scale
  if (/\brug\b/.test(l)) {
    if (/royal|galaxy|rainbow|cozy/.test(l)) return { cols: 6, rows: 5 };
    return { cols: 5, rows: 5 };
  }

  // Yard / structure scale (same footprint as a grown tree)
  if (
    (/\bfountain\b/.test(l) && !/fountain pen/.test(l)) ||
    /\bgreenhouse\b|\bobservatory\b/.test(l)
  ) {
    return { cols: 4, rows: 4 };
  }

  // Long room furniture
  if (/\b(grand )?piano\b/.test(l) && !/keyboard/.test(l)) return { cols: 4, rows: 3 };
  if (/\bdining table\b|\bpicnic table\b/.test(l)) return { cols: 4, rows: 3 };
  if (/\bbed\b(?! tray)/.test(l) && !/\b(cat|dog) bed\b/.test(l)) return { cols: 4, rows: 3 };

  // 3×3 statement pieces
  if (
    /giant mushroom|giant ghost plush|\bbeach umbrella\b|\bscarecrow\b|\bbird bath\b|\bshrine\b|\bdollhouse\b|\bdrum set\b|\bpottery wheel\b|\btoy castle\b|\btoy kitchen\b|\bfish tank\b|\baquarium stand\b|\baquarium\b(?! plants)|\bbathtub\b|\bhammock\b|\btrail kitchen\b|\bcamp kitchen\b/.test(
      l,
    )
  ) {
    return { cols: 3, rows: 3 };
  }

  // Extra-wide 3×2
  if (
    /crescent sofa|harvest wagon|ice cream cart|flower delivery cart|tiny lemonade stand|\bsofa\b|\bthrone\b|\bfireplace\b(?! log)|\bwindow seat\b|\barch\b|\btrellis\b|\bcauldron\b|\bworkbench\b|\bworkshop bench\b|\bchess table\b|\bcard table\b|\btiny pond\b|\bhabitat\b|\bant farm\b|\blocker\b|\bdesk$/.test(
      l,
    )
  ) {
    return { cols: 3, rows: 2 };
  }

  if (/\bcart\b|\bwagon\b/.test(l)) return { cols: 3, rows: 2 };

  // Pet beds are floor mats, not bedroom beds
  if (/\b(cat|dog) bed\b/.test(l)) return { cols: 2, rows: 1 };

  // Square room pieces
  if (
    /\bwardrobe\b|\bbookcase\b|\bbookshelf\b|\bvanity\b(?! mirror)|\bcabinet\b|\bchandelier\b|\bespresso machine\b|\bbakery display\b|\bwatering station\b|\bdresser\b|\bchest\b/.test(
      l,
    )
  ) {
    return { cols: 2, rows: 2 };
  }

  // Wide but shallow
  if (
    /\bdivider\b|\bbench\b|\bironing board\b|\beasel\b|\brecord player\b|\bkeyboard\b|\bbird cage\b|\bneon ghost sign\b|\btapestry\b|\bmantle\b|\bregister\b|\bcot\b|\bsleeping bag\b|\btrain set\b|\bmarble track\b|\bstacked plushies\b|\bfloor cushion stack\b|\bcooler\b|\bbarrel\b|\bottoman\b|\bbean bag\b/.test(
      l,
    )
  ) {
    return { cols: 2, rows: 1 };
  }

  // Small hanging / counter racks stay 1×1
  if (
    /spice rack|mug rack|magazine rack|towel rack|slipper rack|coat rack|pie cooling rack/.test(l)
  ) {
    return { cols: 1, rows: 1 };
  }

  if (/\btable\b|\bshelf\b|\brack\b|\bcrate\b/.test(l)) return { cols: 2, rows: 1 };

  return { cols: 1, rows: 1 };
}
