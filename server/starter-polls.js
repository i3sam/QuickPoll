// Posted to Community once, the first time the feed is opened, so a new
// site doesn't start empty. Set STARTER_POLLS=false to skip them.
// A null author shows as Anonymous.
export const STARTER_POLLS = [
  {
    question: 'Is a hot dog a sandwich?',
    options: ['Yes', 'No', "It's its own thing"],
    author: 'mike_t',
  },
  {
    question: 'Best fast food fries?',
    options: ["McDonald's", "Wendy's", 'Chick-fil-A', 'Five Guys', 'Popeyes'],
    author: null,
  },
  {
    question: 'Pineapple on pizza?',
    options: ['Love it', 'Hate it', 'Only with ham'],
    author: 'Jenna',
  },
  {
    question: 'Should the US switch to the metric system?',
    options: ['Yes', 'No', 'Only for science'],
    author: null,
  },
  {
    question: 'Best Thanksgiving side dish?',
    options: ['Mac and cheese', 'Stuffing', 'Mashed potatoes', 'Green bean casserole', 'Sweet potatoes'],
    author: 'Tyler R.',
  },
  {
    question: 'How much do you tip at a sit-down restaurant?',
    options: ['15%', '18%', '20%', 'More than 20%'],
    author: null,
  },
  {
    question: 'Coke or Pepsi?',
    options: ['Coke', 'Pepsi', 'Dr Pepper, obviously'],
    author: 'carlos',
  },
  {
    question: "What's the best road trip snack?",
    options: ['Beef jerky', 'Sour gummies', 'Chips', 'Sunflower seeds', 'Gas station hot food'],
    multiple: true,
    author: 'Ashley',
  },
  {
    question: 'Where would you rather live?',
    options: ['Texas', 'California', 'Florida', 'New York'],
    author: 'brandon_k',
  },
  {
    question: 'Socks with sandals: acceptable?',
    options: ['Yes', 'No', 'Only at home'],
    author: null,
  },
  {
    question: 'Best pizza style?',
    options: ['New York', 'Chicago deep dish', 'Detroit', 'Neapolitan'],
    author: 'Megan',
  },
];
