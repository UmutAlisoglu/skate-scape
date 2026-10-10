/** Teleport destinations in world tile coordinates (checked for open, rideable ground; see README). */
export interface Place { id: string; name: string; spell: string; tile: [number, number]; blurb: string; region: string }

export const PLACES: Place[] = [
  // Misthalin
  { id: 'lumbridge', name: 'Lumbridge', spell: 'Lumbridge Home Teleport', tile: [3222, 3218], blurb: 'Castle courtyard, the river bridges and the cabbage fields', region: 'Misthalin' },
  { id: 'varrock', name: 'Varrock', spell: 'Varrock Teleport', tile: [3212, 3422], blurb: 'The square, the fountain and long city walls', region: 'Misthalin' },
  { id: 'grandexchange', name: 'Grand Exchange', spell: 'Grand Exchange Teleport', tile: [3165, 3474], blurb: 'A huge circular plaza: the best flatground in Gielinor', region: 'Misthalin' },
  { id: 'draynor', name: 'Draynor Village', spell: 'Draynor Teleport', tile: [3093, 3247], blurb: 'Market stalls, the jail and the willow banks', region: 'Misthalin' },
  { id: 'barbarian', name: 'Barbarian Village', spell: 'Barbarian Teleport', tile: [3083, 3418], blurb: 'Longhall fences beside the river', region: 'Misthalin' },
  { id: 'edgeville', name: 'Edgeville', spell: 'Edgeville Teleport', tile: [3094, 3497], blurb: 'The bank plaza and the wilderness wall', region: 'Misthalin' },
  { id: 'wizards', name: "Wizards' Tower", spell: 'Wizards’ Teleport', tile: [3109, 3168], blurb: 'The island tower and its bridge', region: 'Misthalin' },
  { id: 'champions', name: "Champions' Guild", spell: 'Champions Teleport', tile: [3191, 3366], blurb: 'Hilltop guild lawns south of Varrock', region: 'Misthalin' },
  { id: 'lumberyard', name: 'Lumber Yard', spell: 'Lumber Yard Teleport', tile: [3303, 3490], blurb: 'Log piles and fences north-east of Varrock', region: 'Misthalin' },
  // Kharidian Desert
  { id: 'alkharid', name: 'Al Kharid', spell: 'Al Kharid Teleport', tile: [3291, 3182], blurb: 'Desert palace walls and wide sandy streets', region: 'Kharidian Desert' },
  { id: 'duelarena', name: 'Duel Arena', spell: 'Duel Arena Teleport', tile: [3357, 3234], blurb: 'Sandstone walls and arena ledges', region: 'Kharidian Desert' },
  { id: 'shantay', name: 'Shantay Pass', spell: 'Shantay Teleport', tile: [3304, 3121], blurb: 'The desert gate and its stalls', region: 'Kharidian Desert' },
  { id: 'pollnivneach', name: 'Pollnivneach', spell: 'Pollnivneach Teleport', tile: [3359, 2971], blurb: 'A sandstone town square deep in the desert', region: 'Kharidian Desert' },
  { id: 'nardah', name: 'Nardah', spell: 'Nardah Teleport', tile: [3416, 2894], blurb: 'Sun-bleached streets around the town well', region: 'Kharidian Desert' },
  // Asgarnia
  { id: 'falador', name: 'Falador', spell: 'Falador Teleport', tile: [2965, 3380], blurb: 'The white city: its square, the park and castle walls', region: 'Asgarnia' },
  { id: 'portsarim', name: 'Port Sarim', spell: 'Port Sarim Teleport', tile: [3013, 3217], blurb: 'Docks, jetties and the harbour front', region: 'Asgarnia' },
  { id: 'rimmington', name: 'Rimmington', spell: 'Rimmington Teleport', tile: [2957, 3214], blurb: 'A quiet village between the mines and the coast', region: 'Asgarnia' },
  { id: 'taverley', name: 'Taverley', spell: 'Taverley Teleport', tile: [2895, 3445], blurb: 'Druid walls below White Wolf Mountain', region: 'Asgarnia' },
  { id: 'burthorpe', name: 'Burthorpe', spell: 'Burthorpe Teleport', tile: [2899, 3545], blurb: 'The castle courtyard and the soldiers’ camp', region: 'Asgarnia' },
  // Kandarin
  { id: 'catherby', name: 'Catherby', spell: 'Catherby Teleport', tile: [2808, 3436], blurb: 'Beach front, fishing docks and the market', region: 'Kandarin' },
  { id: 'camelot', name: 'Camelot', spell: 'Camelot Teleport', tile: [2757, 3477], blurb: 'King Arthur’s castle and its lawns', region: 'Kandarin' },
  { id: 'seers', name: "Seers' Village", spell: 'Seers’ Teleport', tile: [2725, 3487], blurb: 'The courthouse, bank and flax fields', region: 'Kandarin' },
  { id: 'fishingguild', name: 'Fishing Guild', spell: 'Fishing Guild Teleport', tile: [2611, 3393], blurb: 'Long piers and jetties over the sea', region: 'Kandarin' },
  { id: 'ardougne', name: 'Ardougne', spell: 'Ardougne Teleport', tile: [2662, 3305], blurb: 'The great market square and its stalls', region: 'Kandarin' },
  { id: 'westardougne', name: 'West Ardougne', spell: 'West Ardougne Teleport', tile: [2529, 3305], blurb: 'Plague city streets behind the walls', region: 'Kandarin' },
  { id: 'yanille', name: 'Yanille', spell: 'Yanille Teleport', tile: [2606, 3093], blurb: 'City walls and the Wizards’ Guild', region: 'Kandarin' },
  { id: 'castlewars', name: 'Castle Wars', spell: 'Castle Wars Teleport', tile: [2442, 3090], blurb: 'Two castles and a battlefield between them', region: 'Kandarin' },
  { id: 'gnome', name: 'Gnome Stronghold', spell: 'Gnome Stronghold Teleport', tile: [2459, 3487], blurb: 'Wooden platforms around the Grand Tree', region: 'Kandarin' },
  { id: 'barbarianoutpost', name: 'Barbarian Outpost', spell: 'Barbarian Outpost Teleport', tile: [2519, 3571], blurb: 'Agility walls and the beach', region: 'Kandarin' },
  // Fremennik Province
  { id: 'rellekka', name: 'Rellekka', spell: 'Rellekka Teleport', tile: [2660, 3657], blurb: 'Longhalls, the market and the harbour', region: 'Fremennik' },
  // Karamja
  { id: 'brimhaven', name: 'Brimhaven', spell: 'Brimhaven Teleport', tile: [2760, 3178], blurb: 'Docks and the pirate town', region: 'Karamja' },
  { id: 'musapoint', name: 'Musa Point', spell: 'Musa Point Teleport', tile: [2918, 3166], blurb: 'Banana plantation and the volcano path', region: 'Karamja' },
  { id: 'shilo', name: 'Shilo Village', spell: 'Shilo Teleport', tile: [2846, 2963], blurb: 'A walled village deep in the jungle', region: 'Karamja' },
  // Morytania
  { id: 'canifis', name: 'Canifis', spell: 'Kharyrll Teleport', tile: [3493, 3488], blurb: 'Werewolf town in the swamp', region: 'Morytania' },
  { id: 'portphasmatys', name: 'Port Phasmatys', spell: 'Ectophial', tile: [3679, 3488], blurb: 'The ghost town’s docks and walls', region: 'Morytania' },
  // Wilderness
  { id: 'darkwarriors', name: 'Dark Warriors’ Fortress', spell: 'Wilderness Obelisk', tile: [3029, 3632], blurb: 'A ruined fortress in the wilderness', region: 'Wilderness' },
  { id: 'graveyard', name: 'Graveyard of Shadows', spell: 'Graveyard Teleport', tile: [3165, 3672], blurb: 'Gravestones and ruins in the wilderness', region: 'Wilderness' },
];

/** Places inside an exported area, with local coordinates (tile centre; z is north-negative). */
export function placesIn(baseTile: [number, number], sizeTiles: [number, number]) {
  return PLACES.flatMap((place) => {
    const x = place.tile[0] - baseTile[0], y = place.tile[1] - baseTile[1];
    return x >= 0 && y >= 0 && x < sizeTiles[0] && y < sizeTiles[1] ? [{ ...place, x: x + 0.5, z: -(y + 0.5) }] : [];
  });
}
export type LocalPlace = ReturnType<typeof placesIn>[number];
