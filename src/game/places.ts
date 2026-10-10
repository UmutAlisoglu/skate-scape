/** Teleport destinations in world tile coordinates (checked for open, rideable ground; see README). */
export interface Place { id: string; name: string; spell: string; tile: [number, number]; blurb: string }

export const PLACES: Place[] = [
  { id: 'lumbridge', name: 'Lumbridge', spell: 'Lumbridge Home Teleport', tile: [3222, 3218], blurb: 'Castle courtyard, the river bridges and the cabbage fields' },
  { id: 'varrock', name: 'Varrock', spell: 'Varrock Teleport', tile: [3212, 3422], blurb: 'The square, the fountain and long city walls' },
  { id: 'draynor', name: 'Draynor Village', spell: 'Draynor Teleport', tile: [3093, 3247], blurb: 'Market stalls, the jail and the willow banks' },
  { id: 'alkharid', name: 'Al Kharid', spell: 'Al Kharid Teleport', tile: [3291, 3182], blurb: 'Desert palace walls and wide sandy streets' },
  { id: 'barbarian', name: 'Barbarian Village', spell: 'Barbarian Teleport', tile: [3083, 3418], blurb: 'Longhall fences beside the river' },
  { id: 'edgeville', name: 'Edgeville', spell: 'Edgeville Teleport', tile: [3094, 3497], blurb: 'The bank plaza and the wilderness wall' },
  { id: 'grandexchange', name: 'Grand Exchange', spell: 'Grand Exchange Teleport', tile: [3165, 3474], blurb: 'A huge circular plaza: the best flatground in Gielinor' },
  { id: 'wizards', name: "Wizards' Tower", spell: 'Wizards’ Teleport', tile: [3109, 3168], blurb: 'The island tower and its bridge' },
  { id: 'duelarena', name: 'Duel Arena', spell: 'Duel Arena Teleport', tile: [3357, 3234], blurb: 'Sandstone walls and arena ledges' },
  { id: 'champions', name: "Champions' Guild", spell: 'Champions Teleport', tile: [3191, 3366], blurb: 'Hilltop guild lawns south of Varrock' },
  { id: 'lumberyard', name: 'Lumber Yard', spell: 'Lumber Yard Teleport', tile: [3303, 3490], blurb: 'Log piles and fences north-east of Varrock' },
];

/** Places inside an exported area, with local coordinates (tile centre; z is north-negative). */
export function placesIn(baseTile: [number, number], sizeTiles: [number, number]) {
  return PLACES.flatMap((place) => {
    const x = place.tile[0] - baseTile[0], y = place.tile[1] - baseTile[1];
    return x >= 0 && y >= 0 && x < sizeTiles[0] && y < sizeTiles[1] ? [{ ...place, x: x + 0.5, z: -(y + 0.5) }] : [];
  });
}
export type LocalPlace = ReturnType<typeof placesIn>[number];
