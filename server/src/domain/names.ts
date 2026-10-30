const ADJECTIVES = [
  'Amber', 'Brave', 'Cosmic', 'Dusty', 'Electric', 'Fancy', 'Golden', 'Hasty', 'Ivory', 'Jolly', 'Kind', 'Lucky',
  'Midnight', 'Noble', 'Odd', 'Proud', 'Quiet', 'Rapid', 'Silver', 'Thunder', 'Urban', 'Velvet', 'Wild', 'Young',
  'Zesty', 'Copper', 'Misty', 'Royal', 'Sunny', 'Stormy', 'Crimson', 'Polar', 'Lunar', 'Scarlet', 'Rusty', 'Gentle',
];
const HORSE_NOUNS = [
  'Arrow', 'Blaze', 'Comet', 'Dancer', 'Echo', 'Falcon', 'Gale', 'Hooves', 'Jet', 'Knight', 'Legend', 'Mustang',
  'Nova', 'Outlaw', 'Pilot', 'Quest', 'Rocket', 'Spirit', 'Tempest', 'Valiant', 'Whisper', 'Zephyr', 'Bolt', 'Charger',
];
const GIRAFFE_NOUNS = [
  'Acacia', 'Beacon', 'Canopy', 'Dune', 'Everest', 'Frond', 'Glimmer', 'Horizon', 'Island', 'Jungle', 'Kilimanjaro', 'Lighthouse',
  'Monsoon', 'Neck', 'Oasis', 'Palm', 'Quill', 'Ridge', 'Savanna', 'Tower', 'Umbrella', 'Vista', 'Willow', 'Zenith',
];

export function animalName(species: string, random: () => number = Math.random): string {
  const nouns = species === 'GIRAFFE' ? GIRAFFE_NOUNS : HORSE_NOUNS;
  const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]!;
  const noun = nouns[Math.floor(random() * nouns.length)]!;
  return `${adjective} ${noun}`;
}

export const TEMPERAMENTS = ['FRONT_RUNNER', 'STALKER', 'CLOSER', 'STEADY'] as const;
