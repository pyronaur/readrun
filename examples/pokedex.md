<!-- Pokédex. Looks up Pokémon named on the command line, or piped in one per line. -->
```ts run
import { parseArgs } from 'util';
import { route } from 'readrun';

await route('Help', ['-h', '--help']);
await route('Version', ['-v', '--version']);

const { values: flags, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    title: { type: 'string', default: 'Pokédex' },
    json: { type: 'boolean', default: false },
    api: { type: 'string', default: 'https://pokeapi.co/api/v2' },
  },
  allowPositionals: true,
});

// Names from the command line, otherwise whatever is piped in.
const names = positionals.length
  ? positionals
  : process.stdin.isTTY ? [] : (await Bun.stdin.text()).split(/\s+/).filter(Boolean);

if (names.length === 0) {
  $: usage = 'Help';
  console.error(usage);
  process.exit(2);
}

const team = await Promise.all(names.map(async name => {
  const response = await fetch(`${flags.api}/pokemon/${name.toLowerCase()}`);
  if (!response.ok) {
    $: missing = 'Not found', { name };
    console.error(missing);
    process.exit(1);
  }
  const pokemon = await response.json();
  return {
    name: pokemon.name,
    id: pokemon.id,
    types: pokemon.types.map(slot => slot.type.name).join(', '),
    height: pokemon.height / 10,
    weight: pokemon.weight / 10,
    stats: pokemon.stats.map(slot => ({ name: slot.stat.name, value: slot.base_stat })),
    species: pokemon.species.url,
  };
}));

if (flags.json) {
  console.log(JSON.stringify(team));
} else {
  $: pokedex = 'Pokédex', { title: flags.title, team };
  console.log(pokedex);
}
```

<!--$: Help -->
Usage: rr examples/pokedex.md [options] <pokemon...>

Looks up Pokémon by name or number. Names can also be piped in, one per line.

Options:
  --title <text>   Heading for the report (default: Pokédex)
  --json           Print JSON instead of Markdown
  --api <url>      PokeAPI base URL (default: https://pokeapi.co/api/v2)

<!--$: Version -->
pokedex 0.1.0

<!--$: Not found -->
No Pokémon named "{{ name }}".

<!--$: Pokédex -->
# {{ title }}

```ts run
const cards = [];
for (const pokemon of team) {
  $: card = 'Card', pokemon;
  cards.push(card);
}
console.log(cards.join('\n\n'));
```

<!--$: Card -->
## #{{ id }} {{ name }}
{{ types }} · {{ height }} m · {{ weight }} kg

```ts run
// Sections can await: fetch the Pokédex entry for this one.
const about = await fetch(species).then(response => response.json());
const entry = about.flavor_text_entries.find(item => item.language.name === 'en');
if (entry) console.log(`> ${entry.flavor_text.replace(/\s+/g, ' ')}`);

for (const stat of stats) {
  $: row = 'Stat', stat;
  console.log(row);
}
```

<!--$: Stat -->
- {{ name }}: {{ value }}
