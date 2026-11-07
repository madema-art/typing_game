/**
 * The Lexicon: interesting words taught through context. Each word comes with a
 * plain-English definition and several sentences that make the meaning clear,
 * so a word can come back later in a sentence the player hasn't seen yet.
 *
 * In context sentences, {braces} mark the word being taught (any inflection).
 */
export interface VocabEntry {
  word: string;
  pos: string;
  def: string;
  /** 1 = everyday-but-useful, 2 = stretch, 3 = advanced. */
  level: 1 | 2 | 3;
  contexts: string[];
}

export const LEXICON: VocabEntry[] = [
  {
    word: 'ephemeral', pos: 'adj.', level: 2, def: 'lasting for a very short time',
    contexts: [
      'The rainbow was {ephemeral}: gone before I found my phone.',
      'Fame is {ephemeral}; a good sandwich is forever.',
      'Snowflakes are {ephemeral} art that melts on your tongue.',
    ],
  },
  {
    word: 'serendipity', pos: 'n.', level: 2, def: 'finding something good by happy accident',
    contexts: [
      'By pure {serendipity}, I found twenty dollars in my winter coat.',
      'Penicillin was found by {serendipity}: a messy lab and a lucky mold.',
      'We met by {serendipity}, reaching for the last waffle at the same time.',
    ],
  },
  {
    word: 'quixotic', pos: 'adj.', level: 3, def: 'hopelessly idealistic; noble but impractical',
    contexts: [
      'Teaching the cat to fetch was a {quixotic} quest, but I had snacks.',
      'His {quixotic} plan: end traffic by giving everyone a hot air balloon.',
    ],
  },
  {
    word: 'ubiquitous', pos: 'adj.', level: 2, def: 'found everywhere',
    contexts: [
      'Glitter is {ubiquitous}; one craft day and it lives in your house forever.',
      'Phones are so {ubiquitous} that even the scarecrow seems to have one.',
    ],
  },
  {
    word: 'cacophony', pos: 'n.', level: 2, def: 'a harsh, jarring mix of loud sounds',
    contexts: [
      'Seven toddlers with kazoos create a {cacophony} no wall can stop.',
      'The morning {cacophony}: alarms, kettles, and one confused rooster.',
    ],
  },
  {
    word: 'petrichor', pos: 'n.', level: 3, def: 'the earthy smell after rain',
    contexts: [
      'After the storm, the air was thick with {petrichor} and worm gossip.',
      '{Petrichor} is the planet saying, "Thanks for the drink."',
    ],
  },
  {
    word: 'ineffable', pos: 'adj.', level: 3, def: 'too great or strange to be put into words',
    contexts: [
      'The view from the summit was {ineffable}, so I just said, "Wow."',
      'Some feelings are {ineffable}; that\'s why we invented music.',
    ],
  },
  {
    word: 'gregarious', pos: 'adj.', level: 2, def: 'sociable; fond of company',
    contexts: [
      'Our {gregarious} dog greets every stranger like a long-lost cousin.',
      'Even the most {gregarious} penguin needs a quiet iceberg sometimes.',
    ],
  },
  {
    word: 'laconic', pos: 'adj.', level: 3, def: 'using very few words',
    contexts: [
      'Asked about his weekend, the {laconic} cowboy said, "Yep."',
      'The {laconic} robot answered every question with a single beep.',
    ],
  },
  {
    word: 'verbose', pos: 'adj.', level: 2, def: 'using more words than needed',
    contexts: [
      'The {verbose} parrot turned a simple "hello" into a twelve-minute speech.',
      'My {verbose} toaster narrates every slice of bread in detail.',
    ],
  },
  {
    word: 'zenith', pos: 'n.', level: 2, def: 'the highest point',
    contexts: [
      'At the {zenith} of his career, the juggler kept 9 pies in the air.',
      'The sun reached its {zenith}, and so did my nap.',
    ],
  },
  {
    word: 'nadir', pos: 'n.', level: 3, def: 'the lowest point',
    contexts: [
      'The {nadir} of my week: dropping toast butter-side down, twice.',
      'Every comeback story starts at a {nadir}.',
    ],
  },
  {
    word: 'mellifluous', pos: 'adj.', level: 3, def: 'sweet and smooth to hear',
    contexts: [
      'The cello\'s {mellifluous} voice made even the cat sit still.',
      'Her {mellifluous} laugh sounded like honey poured over jazz.',
    ],
  },
  {
    word: 'obfuscate', pos: 'v.', level: 3, def: 'to make something unclear on purpose',
    contexts: [
      'Don\'t {obfuscate} the recipe; just tell me how much cheese.',
      'The cat tried to {obfuscate} the crime by sitting on the broken vase.',
    ],
  },
  {
    word: 'juxtapose', pos: 'v.', level: 2, def: 'to place side by side to show contrast',
    contexts: [
      'The artist chose to {juxtapose} a tiny snail and a giant traffic cone.',
      'If you {juxtapose} Monday and Friday, Friday wins every time.',
    ],
  },
  {
    word: 'ambivalent', pos: 'adj.', level: 2, def: 'having mixed feelings about something',
    contexts: [
      'I\'m {ambivalent} about rain: great for naps, terrible for picnics.',
      'The cat seems {ambivalent} toward the new sofa; she sits, then glares.',
    ],
  },
  {
    word: 'candor', pos: 'n.', level: 2, def: 'honest, open frankness',
    contexts: [
      'With refreshing {candor}, the waiter said, "Skip the fish."',
      'Kids speak with total {candor}: "Your haircut looks like a broom."',
    ],
  },
  {
    word: 'debacle', pos: 'n.', level: 2, def: 'a sudden, embarrassing failure',
    contexts: [
      'The birthday cake {debacle} of 2019 still haunts the kitchen.',
      'Folding a fitted sheet always ends in a {debacle}.',
    ],
  },
  {
    word: 'euphoria', pos: 'n.', level: 1, def: 'a feeling of intense happiness',
    contexts: [
      'Finding the TV remote brought a wave of pure {euphoria}.',
      'A dog\'s {euphoria} at the word "walk" is unmatched in nature.',
    ],
  },
  {
    word: 'facetious', pos: 'adj.', level: 3, def: 'joking when you should be serious',
    contexts: [
      'Calling the flood a "free pool" was {facetious}, but we laughed.',
      'Don\'t be {facetious} during the fire drill; the alarm is not a DJ.',
    ],
  },
  {
    word: 'frugal', pos: 'adj.', level: 1, def: 'careful with money; thrifty',
    contexts: [
      'My {frugal} grandpa reuses tea bags until they file complaints.',
      'Being {frugal} is fun until you spend an hour counting coupons.',
    ],
  },
  {
    word: 'gargantuan', pos: 'adj.', level: 2, def: 'enormous',
    contexts: [
      'The {gargantuan} pizza needed its own chair at the table.',
      'A blue whale\'s heart is {gargantuan}: about the size of a small car.',
    ],
  },
  {
    word: 'hubris', pos: 'n.', level: 3, def: 'excessive pride or self-confidence',
    contexts: [
      'Pure {hubris}: I said, "Who needs instructions?" and built a wobbly shelf.',
      'The hare\'s {hubris} lost the race; the tortoise just kept walking.',
    ],
  },
  {
    word: 'idiosyncrasy', pos: 'n.', level: 3, def: 'a peculiar personal habit',
    contexts: [
      'One {idiosyncrasy} of my uncle: he salutes every pigeon he sees.',
      'Eating fries with chopsticks is her favorite {idiosyncrasy}.',
    ],
  },
  {
    word: 'jubilant', pos: 'adj.', level: 1, def: 'joyfully triumphant',
    contexts: [
      'The {jubilant} team carried the goalkeeper around like a trophy.',
      'I was {jubilant} when the printer worked on the first try.',
    ],
  },
  {
    word: 'kerfuffle', pos: 'n.', level: 2, def: 'a commotion or fuss',
    contexts: [
      'There was a small {kerfuffle} when two ducks claimed the same bread.',
      'The office {kerfuffle} began when someone microwaved fish.',
    ],
  },
  {
    word: 'lethargic', pos: 'adj.', level: 2, def: 'sluggish; lacking energy',
    contexts: [
      'After the holiday dinner, the whole family was {lethargic} and proud of it.',
      'Sloths look {lethargic}, but they are just very careful planners.',
    ],
  },
  {
    word: 'meticulous', pos: 'adj.', level: 2, def: 'extremely careful about details',
    contexts: [
      'The {meticulous} chef placed each sprinkle with tweezers.',
      'Bees are {meticulous} architects: every cell is a perfect hexagon.',
    ],
  },
  {
    word: 'nonchalant', pos: 'adj.', level: 2, def: 'calm and unconcerned',
    contexts: [
      'The {nonchalant} cat watched the vacuum cleaner without blinking.',
      'He stayed {nonchalant} as the goat ate his homework.',
    ],
  },
  {
    word: 'oblivious', pos: 'adj.', level: 1, def: 'not aware of what is happening',
    contexts: [
      'Totally {oblivious}, the dog chased its tail through the wedding photos.',
      'I was {oblivious} to the spinach in my teeth for the entire date.',
    ],
  },
  {
    word: 'paradox', pos: 'n.', level: 2, def: 'something that seems to contradict itself yet may be true',
    contexts: [
      'Here\'s a {paradox}: the longer you nap, the more tired you feel.',
      'This sentence is a lie; welcome to your first {paradox}.',
    ],
  },
  {
    word: 'quandary', pos: 'n.', level: 2, def: 'a state of uncertainty about what to do',
    contexts: [
      'Pizza or tacos? My stomach is in a delicious {quandary}.',
      'The squirrel faced a {quandary}: one nut, two perfect hiding spots.',
    ],
  },
  {
    word: 'resilient', pos: 'adj.', level: 1, def: 'able to recover quickly from setbacks',
    contexts: [
      'Dandelions are {resilient}; mow them down and they wave back by Friday.',
      'Be {resilient} like a rubber duck: always float back up.',
    ],
  },
  {
    word: 'sanguine', pos: 'adj.', level: 3, def: 'cheerfully optimistic, even when things look bad',
    contexts: [
      'Even with two flat tires, Dad stayed {sanguine}: "More time to sing!"',
      'The {sanguine} captain called the leak "a bonus swimming pool."',
    ],
  },
  {
    word: 'tenacious', pos: 'adj.', level: 2, def: 'persistent; refusing to give up',
    contexts: [
      'The {tenacious} ant carried a crumb twice its size up the wall.',
      'A {tenacious} mosquito followed me through three rooms and a shower.',
    ],
  },
  {
    word: 'vex', pos: 'v.', level: 2, def: 'to annoy, frustrate or puzzle',
    contexts: [
      'Crossword clues that end in "x" always {vex} me.',
      'Nothing will {vex} a cat more than a door it just asked you to open.',
    ],
  },
  {
    word: 'whimsical', pos: 'adj.', level: 1, def: 'playfully quaint or fanciful',
    contexts: [
      'The {whimsical} bakery sold cupcakes shaped like tiny planets.',
      'Her {whimsical} garden had gnomes playing chess with flamingos.',
    ],
  },
  {
    word: 'yearn', pos: 'v.', level: 1, def: 'to long for something deeply',
    contexts: [
      'In January, I {yearn} for summer; in August, I {yearn} for snow.',
      'Old sailors {yearn} for the sea the way cats long for boxes.',
    ],
  },
  {
    word: 'zealous', pos: 'adj.', level: 2, def: 'full of eager enthusiasm',
    contexts: [
      'The {zealous} intern alphabetized the snacks, then the staplers.',
      'A {zealous} fan painted his house in team colors, including the doghouse.',
    ],
  },
  {
    word: 'eloquent', pos: 'adj.', level: 1, def: 'fluent and persuasive in speaking or writing',
    contexts: [
      'The {eloquent} toddler argued for dessert like a tiny lawyer.',
      'Silence can be {eloquent}; just ask a cat staring at an empty bowl.',
    ],
  },
  {
    word: 'enigma', pos: 'n.', level: 2, def: 'a mysterious person or thing',
    contexts: [
      'The cat is an {enigma}: she begs to go out, then stares at the open door.',
      'Stonehenge remains an {enigma}, mostly because the stones won\'t talk.',
    ],
  },
  {
    word: 'procrastinate', pos: 'v.', level: 1, def: 'to keep putting off something you should do',
    contexts: [
      'I planned to {procrastinate} today, but I\'ll do it tomorrow.',
      'Students {procrastinate}; then, at midnight, they become geniuses.',
    ],
  },
  {
    word: 'benevolent', pos: 'adj.', level: 2, def: 'kind and generous',
    contexts: [
      'The {benevolent} dragon guarded the village and baked it cookies.',
      'A {benevolent} stranger paid for my coffee; I\'m still emotional.',
    ],
  },
  {
    word: 'capricious', pos: 'adj.', level: 3, def: 'changing mood or behavior suddenly',
    contexts: [
      'Spring weather is {capricious}: sun, hail, and a rainbow before lunch.',
      'The {capricious} cat loves you, then bites you, then loves you again.',
    ],
  },
  {
    word: 'dichotomy', pos: 'n.', level: 3, def: 'a division into two opposite parts',
    contexts: [
      'The great {dichotomy} of life: cats who sit, and cats who knock things over.',
      'There\'s a strange {dichotomy} between my gym bag and my snack drawer.',
    ],
  },
  {
    word: 'ebullient', pos: 'adj.', level: 3, def: 'cheerful and bubbling with energy',
    contexts: [
      'The {ebullient} puppy greeted the mail carrier with 40 tail wags.',
      'Her {ebullient} laugh made even the grumpy librarian smile.',
    ],
  },
  {
    word: 'flabbergasted', pos: 'adj.', level: 1, def: 'extremely surprised',
    contexts: [
      'I was {flabbergasted} when the goldfish learned to high-five.',
      'Grandma was {flabbergasted} to learn her phone was in her hand.',
    ],
  },
  {
    word: 'gullible', pos: 'adj.', level: 1, def: 'easily tricked into believing things',
    contexts: [
      'Fun fact: "{gullible}" isn\'t in the dictionary. (Go check; we\'ll wait.)',
      'The {gullible} tourist paid ten dollars to see a "rare" ordinary pigeon.',
    ],
  },
  {
    word: 'incognito', pos: 'adv.', level: 2, def: 'with your true identity hidden',
    contexts: [
      'The celebrity traveled {incognito}: sunglasses, hat, and a fake mustache.',
      'A dog in a trench coat is the least {incognito} thing imaginable.',
    ],
  },
  {
    word: 'nostalgia', pos: 'n.', level: 1, def: 'a sentimental longing for the past',
    contexts: [
      'The smell of crayons fills me with {nostalgia} and a desire to color outside the lines.',
      '{Nostalgia} is remembering the good parts of a time we called "boring."',
    ],
  },
  {
    word: 'onomatopoeia', pos: 'n.', level: 3, def: 'a word that imitates the sound it names',
    contexts: [
      'Buzz, boom, and sizzle are all examples of {onomatopoeia}.',
      'The comic book was pure {onomatopoeia}: BAM! POW! WHOOSH!',
    ],
  },
  {
    word: 'plethora', pos: 'n.', level: 2, def: 'a large or excessive amount',
    contexts: [
      'My junk drawer holds a {plethora} of rubber bands and mysterious keys.',
      'The buffet offered a {plethora} of choices; I chose all of them.',
    ],
  },
  {
    word: 'quintessential', pos: 'adj.', level: 3, def: 'the most perfect example of something',
    contexts: [
      'A rainy Sunday with soup is the {quintessential} lazy day.',
      'The {quintessential} cat move: pushing a glass off the table while making eye contact.',
    ],
  },
  {
    word: 'trepidation', pos: 'n.', level: 2, def: 'fear or worry about what may happen',
    contexts: [
      'With great {trepidation}, I opened the container from the back of the fridge.',
      'The cat approached the cucumber with {trepidation}.',
    ],
  },
  {
    word: 'wanderlust', pos: 'n.', level: 1, def: 'a strong desire to travel',
    contexts: [
      'Every airplane overhead gives my {wanderlust} a little poke.',
      'Even my suitcase seems to have {wanderlust}; it never stays unpacked.',
    ],
  },
  {
    word: 'luminous', pos: 'adj.', level: 1, def: 'full of light; glowing',
    contexts: [
      '{Luminous} jellyfish turned the dark bay into a galaxy.',
      'Fireflies make summer nights feel {luminous} and secret.',
    ],
  },
  {
    word: 'mundane', pos: 'adj.', level: 1, def: 'ordinary and dull',
    contexts: [
      'Even {mundane} chores are fun when you narrate them like a nature documentary.',
      'The dragon found tax season incredibly {mundane}.',
    ],
  },
  {
    word: 'meander', pos: 'v.', level: 1, def: 'to wander slowly without a clear direction',
    contexts: [
      'The river likes to {meander}, like a cat walking to its food bowl.',
      'On Sundays, my thoughts {meander} from pancakes to the meaning of life.',
    ],
  },
  {
    word: 'ominous', pos: 'adj.', level: 1, def: 'suggesting that something bad is about to happen',
    contexts: [
      'The {ominous} silence meant the toddler had found the markers.',
      'Dark clouds gathered, looking {ominous} and a little dramatic.',
    ],
  },
  {
    word: 'pristine', pos: 'adj.', level: 1, def: 'in perfect, unspoiled condition',
    contexts: [
      'The new carpet stayed {pristine} for exactly four minutes.',
      'Fresh snow looks {pristine} until the dog discovers it.',
    ],
  },
];

export const LEXICON_BY_WORD = new Map(LEXICON.map((e) => [e.word, e]));
