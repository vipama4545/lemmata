// This script processes the scraped dictionary data into a clean format for the React app
// Run it after scraping is complete: node scripts/buildWordData.js

const fs = require('fs');
const path = require('path');

// Georgian thematic group -> English category mapping
const categoryMap = {
  'ქმედება და მდგომარეობა, მიმართული მოძრაობა': 'Actions & States',
  'დრო, ადგილი, სივრცე, ზომა-წონა': 'Time, Place & Measurements',
  'წარმომავლობის სახელები': 'Names & Origins',
  'თვისებები და მახასიათებლები': 'Qualities & Characteristics',
  'რაოდენობა, რიგი, ნაწილი': 'Quantity, Order & Parts',
  'სხვადასხვა': 'Miscellaneous',
  'პროფესიები, საქმიანობა': 'Professions & Work',
  'კვება, საჭმელ-სასმელი': 'Food & Drink',
  'განათლება, მეცნიერება': 'Education & Science',
  'გარესამყარო': 'Nature & Environment',
  'ფლორა': 'Flora',
  'ზოგადი ცნებები': 'General Concepts',
  'ჯანმრთელობა, ჰიგიენა': 'Health & Hygiene',
  'პიროვნული და საზოგადოებრივი ურთიერთობები': 'Personal & Social Relations',
  'საცხოვრებელი გარემო': 'Home & Living Environment',
  'ფაუნა': 'Fauna',
  'იდენტიფიკაცია': 'Identification',
  'გრძნობა-აღქმა, ემოცია, განწყობა': 'Feelings & Emotions',
  'ავეჯი, ჭურჭელი, საოჯახო ნივთები': 'Clothing & Household Items',
  'ოჯახი, ნათესავები': 'Family & Relatives',
  'კულტურა და ხელოვნება': 'Culture & Art',
  'ყოველდღიურობა': 'Daily Life',
  'ადამიანის გარეგნობა, თვისებები, ხასიათი': 'Human Appearance & Character',
  'საქმიანი ურთიერთობა': 'Business Relations',
  'ეტიკეტი': 'Ethics',
  'სხეულის ნაწილები და შინაგანი ორგანოები': 'Body Parts & Organs',
  'მომსახურების სფერო': 'Services',
  'სამეტყველო ინსტრუმენტები': 'Speaking Instruments',
  'პოლიტიკა, სახელმწიფო მოწყობა და მართვა': 'Politics & Government',
  'თავისუფალი დრო, გართობა': 'Free Time & Entertainment',
  'მგზავრობა, მოგზაურობა': 'Travel',
  'ტრანსპორტი': 'Transport',
  'საყიდლები': 'Shopping',
  'სპორტი': 'Sport',
  'ტანსაცმელი, ფეხსაცმელი, აქსესუარები': 'Clothing & Accessories',
  'გეოგრაფიული სახელები': 'Geographical Names',
  'უნარები, ჰობი': 'Abilities & Hobbies',
  'საგანგებო სიტუაცია': 'Emergency Situations',
  'რელიგია': 'Religion',
  'საინფორმაციო საშუალებები': 'Information Technology',
  'კითხვითი სიტყვები': 'Question Words',
  'პირთა სახელები და გვარები': 'Personal Names & Surnames',
};

// Category icons (emoji)
const categoryIcons = {
  'Actions & States': '⚡',
  'Time, Place & Measurements': '🕐',
  'Names & Origins': '🏷️',
  'Qualities & Characteristics': '✨',
  'Quantity, Order & Parts': '🔢',
  'Miscellaneous': '📋',
  'Professions & Work': '💼',
  'Food & Drink': '🍽️',
  'Education & Science': '📚',
  'Nature & Environment': '🌿',
  'Flora': '🌱',
  'General Concepts': '💡',
  'Health & Hygiene': '🏥',
  'Personal & Social Relations': '🤝',
  'Home & Living Environment': '🏠',
  'Fauna': '🐾',
  'Identification': '🆔',
  'Feelings & Emotions': '😊',
  'Clothing & Household Items': '👔',
  'Family & Relatives': '👨‍👩‍👧‍👦',
  'Culture & Art': '🎨',
  'Daily Life': '☀️',
  'Human Appearance & Character': '👤',
  'Business Relations': '🏢',
  'Ethics': '⚖️',
  'Body Parts & Organs': '🫀',
  'Services': '🔧',
  'Speaking Instruments': '📢',
  'Politics & Government': '🏛️',
  'Free Time & Entertainment': '🎮',
  'Travel': '✈️',
  'Transport': '🚗',
  'Shopping': '🛒',
  'Sport': '⚽',
  'Clothing & Accessories': '👗',
  'Geographical Names': '🌍',
  'Abilities & Hobbies': '🎯',
  'Emergency Situations': '🚨',
  'Religion': '⛪',
  'Information Technology': '💻',
  'Question Words': '❓',
  'Personal Names & Surnames': '📝',
};

// Read scraped data
const rawData = fs.readFileSync('/tmp/word_details.json', 'utf-8');
const raw = JSON.parse(rawData);

const categories = {};
const allWords = [];

for (const [georgian, data] of Object.entries(raw)) {
  const temaGeo = data.thematic_group || 'Uncategorized';
  const categoryEn = categoryMap[temaGeo] || temaGeo;
  const icon = categoryIcons[categoryEn] || '📌';

  if (!categories[categoryEn]) {
    categories[categoryEn] = {
      id: categoryEn.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: categoryEn,
      nameGeorgian: temaGeo,
      icon: icon,
      words: [],
    };
  }

  // Get primary English translation
  const primaryEnglish = data.english && data.english.length > 0
    ? data.english[0].split(',')[0].trim()
    : '';

  const word = {
    id: data.id,
    georgian: georgian,
    english: primaryEnglish,
    englishFull: data.english || [],
    georgianDefinition: data.georgian_definition || '',
    level: data.level,
    partOfSpeech: data.part_of_speech || '',
    category: categoryEn,
    categoryId: categories[categoryEn].id,
  };

  categories[categoryEn].words.push(word);
  allWords.push(word);
}

// Sort categories by word count
const sortedCategories = Object.values(categories).sort((a, b) => b.words.length - a.words.length);

const output = {
  categories: sortedCategories.map(c => ({
    id: c.id,
    name: c.name,
    nameGeorgian: c.nameGeorgian,
    icon: c.icon,
    wordCount: c.words.length,
  })),
  words: allWords,
};

const outputPath = path.join(__dirname, '..', 'src', 'data', 'words.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

console.log(`Generated ${outputPath}`);
console.log(`Categories: ${output.categories.length}`);
console.log(`Words: ${output.words.length}`);

// Print category summary
for (const cat of output.categories) {
  console.log(`  ${cat.icon} ${cat.name}: ${cat.wordCount} words`);
}
