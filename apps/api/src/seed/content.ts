/** Seed content for Lodos: data only. Prices are written in lira (VAT-inclusive) and converted to kuruş by `seed.ts`. */
import type { ALLERGENS, ShiftArea } from "@lodos/shared";

type Allergen = (typeof ALLERGENS)[number];
export type Txt = { en: string; tr: string };
export type Station = "kitchen" | "bar";
export type Dietary = "vegetarian" | "vegan" | "gluten-free";
export type SeedOptionGroup = {
  id: string;
  name: Txt;
  type: "single" | "multi";
  required: boolean;
  /** `delta` is in lira. */
  options: { id: string; name: Txt; delta: number }[];
};
export type SeedItem = {
  slug: string;
  category: string;
  name: Txt;
  description: Txt;
  story: Txt;
  /** Lira. */
  price: number;
  allergens: Allergen[];
  dietary: Dietary[];
  groups?: SeedOptionGroup[];
};

/** VAT (KDV) rate by category: alcohol is 20, everything else 10. */
export const VAT_BY_CATEGORY: Record<string, 10 | 20> = { cocktails: 20, wine: 20 };
export const vatRateOf = (category: string): 10 | 20 => VAT_BY_CATEGORY[category] ?? 10;

const t = (en: string, tr: string): Txt => ({ en, tr });

export const CATEGORIES: { key: string; name: Txt; station: Station }[] = [
  { key: "share", name: t("To share", "Paylaşmalık"), station: "kitchen" },
  { key: "raw", name: t("Raw bar", "Çiğ bar"), station: "kitchen" },
  { key: "fire", name: t("From the fire", "Ateşten"), station: "kitchen" },
  { key: "sides", name: t("Sides", "Yanlar"), station: "kitchen" },
  { key: "desserts", name: t("Desserts", "Tatlılar"), station: "kitchen" },
  { key: "cocktails", name: t("Cocktails", "Kokteyller"), station: "bar" },
  { key: "wine", name: t("Wine", "Şarap"), station: "bar" },
  { key: "zero", name: t("Zero-proof", "Alkolsüz"), station: "bar" },
];

const wineSize = (extra: number): SeedOptionGroup => ({
  id: "size",
  name: t("Size", "Boy"),
  type: "single",
  required: true,
  options: [
    { id: "12cl", name: t("12 cl", "12 cl"), delta: 0 },
    { id: "18cl", name: t("18 cl", "18 cl"), delta: extra },
  ],
});

export const ITEMS: SeedItem[] = [
  // To share
  {
    slug: "burrata", category: "share", price: 540, allergens: ["milk", "gluten"], dietary: ["vegetarian"],
    name: t("Burrata, heirloom tomato", "Burrata, yerli domates"),
    description: t(
      "Creamy burrata, ripe tomatoes, basil oil, smoked sea salt and grilled sourdough.",
      "Kremsi burrata, olgun domates, fesleğen yağı, füme deniz tuzu ve ızgara ekşi mayalı ekmek.",
    ),
    story: t(
      "The tomatoes come every morning from a family greenhouse outside Silivri. We season them with nothing but salt.",
      "Domatesler her sabah Silivri'deki bir aile serasından gelir. Üzerine tuzdan başka bir şey koymayız.",
    ),
  },
  {
    slug: "hummus", category: "share", price: 480, allergens: ["sesame", "gluten"], dietary: [],
    name: t("Hummus, spiced lamb", "Humus, baharatlı kuzu"),
    description: t(
      "Silky hummus topped with slow-cooked lamb, brown butter, pine nuts and warm flatbread.",
      "İpek kıvamında humus, üzerinde yavaş pişmiş kuzu, kızarmış tereyağı, çam fıstığı ve sıcak lavaş.",
    ),
    story: t(
      "We whip the hummus for ten minutes until it turns to silk. The lamb simmers with cumin and Aleppo pepper.",
      "Humusu on dakika çırpıp ipeğe çeviriyoruz. Kuzu kimyon ve Antep biberiyle yavaş yavaş pişer.",
    ),
  },
  {
    slug: "grilled-octopus", category: "share", price: 920, allergens: ["molluscs"], dietary: ["gluten-free"],
    name: t("Charred octopus, fava, capers", "Közlenmiş ahtapot, fava, kapari"),
    description: t(
      "Tender octopus off the charcoal, warm fava purée, capers and a lemon-parsley oil.",
      "Közden çıkmış yumuşacık ahtapot, sıcak fava ezmesi, kapari ve limonlu maydanoz yağı.",
    ),
    story: t(
      "Simmered for an hour, then kissed by the charcoal, so it stays tender inside and smoky outside.",
      "Bir saat haşlanır, sonra közde son dokunuşu alır. İçi yumuşak, dışı dumanlı kalır.",
    ),
  },
  {
    slug: "fried-calamari", category: "share", price: 620, allergens: ["molluscs", "gluten", "eggs"], dietary: [],
    name: t("Crispy calamari, lemon aioli", "Çıtır kalamar, limonlu aioli"),
    description: t(
      "Lightly battered calamari rings and tentacles with a sharp lemon aioli.",
      "Hafif hamurlu kalamar halkaları ve dokunaçlar, yanında keskin limonlu aioli.",
    ),
    story: t(
      "Inspired by the calamari at the Karaköy fish stalls, with a lighter batter and a better sauce.",
      "Karaköy balıkçılarının kalamarından esinlendi: daha hafif bir hamur, daha iyi bir sos.",
    ),
  },
  {
    slug: "baked-feta", category: "share", price: 520, allergens: ["milk", "gluten"], dietary: ["vegetarian"],
    name: t("Baked feta, thyme honey", "Fırında beyaz peynir, kekik balı"),
    description: t(
      "Feta baked until blistered, with thyme honey, chili flakes and charred bread.",
      "Kabarana kadar fırınlanmış beyaz peynir, kekik balı, pul biber ve közlenmiş ekmek.",
    ),
    story: t(
      "Baked until the edges blister, then finished with thyme honey and a pinch of heat.",
      "Kenarları kabarana kadar fırınlanır, kekik balı ve bir tutam acıyla tamamlanır.",
    ),
  },
  // Raw bar
  {
    slug: "levrek-crudo", category: "raw", price: 780, allergens: ["fish"], dietary: ["gluten-free"],
    name: t("Levrek crudo, citrus, green apple", "Levrek crudo, narenciye, yeşil elma"),
    description: t(
      "Thinly sliced sea bass with citrus, green apple, fennel and cold-pressed olive oil.",
      "İnce dilimlenmiş levrek, narenciye, yeşil elma, rezene ve soğuk sıkım zeytinyağı.",
    ),
    story: t(
      "Line-caught Marmara sea bass, sliced to order. Add burrata if you want it richer.",
      "Marmara'dan oltayla yakalanmış levrek, sipariş üzerine dilimlenir. Daha dolgun isterseniz burrata ekleyin.",
    ),
    groups: [
      {
        id: "extras", name: t("Extras", "Ekstralar"), type: "multi", required: false,
        options: [
          { id: "burrata", name: t("Add burrata", "Burrata ekle"), delta: 180 },
          { id: "roe", name: t("Add smoked roe", "Füme balık yumurtası ekle"), delta: 220 },
        ],
      },
    ],
  },
  {
    slug: "tuna-tartare", category: "raw", price: 860, allergens: ["fish", "sesame", "soybeans", "gluten"], dietary: [],
    name: t("Tuna tartare, avocado, sesame cracker", "Ton balığı tartar, avokado, susamlı kraker"),
    description: t(
      "Hand-cut tuna with avocado, sesame oil and a crisp house-baked cracker.",
      "Elle doğranmış ton balığı, avokado, susam yağı ve evde pişen çıtır kraker.",
    ),
    story: t(
      "Cut by hand for every order and bound with a little soy. The cracker is baked in our kitchen.",
      "Her sipariş için elle doğranır, az soya ile birleştirilir. Kraker mutfağımızda pişer.",
    ),
  },
  {
    slug: "oysters", category: "raw", price: 690, allergens: ["molluscs", "sulphites"], dietary: ["gluten-free"],
    name: t("Oysters, red wine mignonette (3)", "İstiridye, kırmızı şarap mignonette (3 adet)"),
    description: t(
      "Three fresh oysters on crushed ice with shallot and red wine vinegar mignonette.",
      "Kırılmış buz üzerinde üç taze istiridye, arpacık soğanlı kırmızı şarap sirkesi mignonette.",
    ),
    story: t(
      "Opened at the pass moments before they reach you, so they taste of the sea and nothing else.",
      "Size ulaşmadan hemen önce açılır, denizden başka bir şey tatmazsınız.",
    ),
  },
  {
    slug: "beef-carpaccio", category: "raw", price: 840, allergens: ["milk", "mustard"], dietary: ["gluten-free"],
    name: t("Beef carpaccio, aged parmesan", "Dana carpaccio, olgun parmesan"),
    description: t(
      "Paper-thin dry-aged beef, rocket, aged parmesan, mustard dressing and lemon.",
      "Kağıt inceliğinde dinlendirilmiş dana, roka, olgun parmesan, hardallı sos ve limon.",
    ),
    story: t(
      "Made from the trimmings of our ribeye, because nothing is wasted in this kitchen.",
      "Antrikot kırpıntılarından yapılır, çünkü bu mutfakta hiçbir şey boşa gitmez.",
    ),
  },
  // From the fire
  {
    slug: "dry-aged-ribeye", category: "fire", price: 2450, allergens: ["celery"], dietary: ["gluten-free"],
    name: t("Dry-aged ribeye, 300 g", "Dinlendirilmiş antrikot, 300 g"),
    description: t(
      "Thirty-five-day dry-aged ribeye from the charcoal, bone marrow jus and roasted garlic.",
      "Kömürde pişen otuz beş gün dinlendirilmiş antrikot, ilik jusu ve közlenmiş sarımsak.",
    ),
    story: t(
      "Aged on the bone in the glass cabinet by the entrance and finished over oak charcoal.",
      "Girişteki cam dolapta kemik üstünde dinlendirilir ve meşe kömüründe tamamlanır.",
    ),
    groups: [
      {
        id: "doneness", name: t("Doneness", "Pişirme"), type: "single", required: true,
        options: [
          { id: "rare", name: t("Rare", "Az pişmiş"), delta: 0 },
          { id: "medium-rare", name: t("Medium rare", "Orta az pişmiş"), delta: 0 },
          { id: "medium", name: t("Medium", "Orta pişmiş"), delta: 0 },
          { id: "well-done", name: t("Well done", "İyi pişmiş"), delta: 0 },
        ],
      },
    ],
  },
  {
    slug: "lamb-chops", category: "fire", price: 1650, allergens: ["milk"], dietary: ["gluten-free"],
    name: t("Lamb chops, mint yoghurt", "Kuzu pirzola, naneli yoğurt"),
    description: t(
      "Four chops with pomegranate molasses, mint yoghurt and charred spring onion.",
      "Dört kuzu pirzola, nar ekşisi, naneli yoğurt ve közlenmiş taze soğan.",
    ),
    story: t(
      "Marinated overnight in yoghurt and garlic, then seared hard until the fat crackles.",
      "Bir gece yoğurt ve sarımsakta bekler, yağı çıtırdayana kadar yüksek ateşte mühürlenir.",
    ),
  },
  {
    slug: "sea-bream", category: "fire", price: 1380, allergens: ["fish"], dietary: ["gluten-free"],
    name: t("Whole sea bream, preserved lemon", "Bütün çupra, tuzlu limon"),
    description: t(
      "Whole sea bream grilled with preserved lemon and fennel, served with a herb salad.",
      "Tuzlu limon ve rezeneyle ızgarada pişen bütün çupra, yanında otlu salata.",
    ),
    story: t(
      "Cooked whole over the fire so the skin crisps and the flesh stays juicy.",
      "Bütün olarak ateşte pişer, kabuğu çıtır, eti sulu kalır.",
    ),
  },
  {
    slug: "spatchcock-chicken", category: "fire", price: 1150, allergens: ["milk"], dietary: ["gluten-free"],
    name: t("Spatchcock chicken, sumac, garlic labneh", "Ezilmiş piliç, sumak, sarımsaklı labne"),
    description: t(
      "Half a brined chicken, grilled under a brick, with sumac onions and garlic labneh.",
      "Salamurada bekleyen yarım piliç, tuğla altında ızgara, yanında sumaklı soğan ve sarımsaklı labne.",
    ),
    story: t(
      "Brined for a day and pressed under a brick on the grill for skin that shatters.",
      "Bir gün salamurada bekler, ızgarada tuğla altında pişer. Derisi çıtır çıtırdır.",
    ),
  },
  {
    slug: "king-prawns", category: "fire", price: 1290, allergens: ["crustaceans", "milk"], dietary: ["gluten-free"],
    name: t("King prawns, nduja butter", "Kral karides, nduja tereyağı"),
    description: t(
      "Grilled king prawns in spicy nduja butter with a charred lemon.",
      "Acılı nduja tereyağında ızgara kral karides ve közlenmiş limon.",
    ),
    story: t(
      "Best eaten with your hands and a lot of bread to mop up the butter.",
      "Elle yenir, tereyağını silmek için bolca ekmek gerekir.",
    ),
  },
  {
    slug: "grilled-mushroom", category: "fire", price: 780, allergens: ["sesame", "nuts"], dietary: ["vegan", "gluten-free"],
    name: t("Charred king oyster mushroom, tahini", "Közlenmiş kral mantar, tahin"),
    description: t(
      "Scored king oyster mushrooms glazed in tahini with toasted hazelnuts and chives.",
      "Çizilmiş kral istiridye mantarı, tahin glazürü, kavrulmuş fındık ve frenk soğanı.",
    ),
    story: t(
      "Our vegetarian showpiece: scored, charred and glazed until it eats like steak.",
      "Vejetaryen vitrinimiz: çizilir, közlenir ve glazelenir. Bir biftek gibi yenir.",
    ),
  },
  // Sides
  {
    slug: "truffle-fries", category: "sides", price: 380, allergens: ["milk"], dietary: ["vegetarian", "gluten-free"],
    name: t("Truffle fries, aged parmesan", "Trüflü patates, olgun parmesan"),
    description: t(
      "Twice-cooked fries with black truffle and shaved parmesan.",
      "İki kez kızartılmış patates, siyah trüf ve rendelenmiş parmesan.",
    ),
    story: t(
      "The order every table swears they will share, and then does not.",
      "Her masanın paylaşacağız deyip paylaşmadığı sipariş.",
    ),
  },
  {
    slug: "roast-potatoes", category: "sides", price: 340, allergens: [], dietary: ["vegan", "gluten-free"],
    name: t("Crushed potatoes, rosemary", "Ezilmiş patates, biberiye"),
    description: t(
      "Hand-crushed potatoes roasted in olive oil with rosemary and flaky salt.",
      "Elle ezilmiş patates, zeytinyağında biberiye ve tuz pullarıyla kavrulur.",
    ),
    story: t(
      "Roasted until the edges turn glassy, which is the only part anyone fights over.",
      "Kenarları camsı olana kadar kavrulur, herkesin kapıştığı kısım orasıdır.",
    ),
  },
  {
    slug: "green-salad", category: "sides", price: 360, allergens: ["mustard"], dietary: ["vegan", "gluten-free"],
    name: t("Little gem, herbs, lemon", "Baby marul, otlar, limon"),
    description: t(
      "Little gem lettuce with dill, mint and a sharp lemon-mustard dressing.",
      "Baby marul, dereotu, nane ve keskin limonlu hardal sosu.",
    ),
    story: t(
      "A palate cleanser between plates, dressed at the last second.",
      "Tabaklar arasında damak temizleyici, son saniyede sosu eklenir.",
    ),
  },
  // Desserts
  {
    slug: "basque-cheesecake", category: "desserts", price: 460, allergens: ["milk", "eggs", "gluten"], dietary: ["vegetarian"],
    name: t("Basque cheesecake, sour cherry", "Bask cheesecake, vişne"),
    description: t(
      "Burnt-top cheesecake with a soft centre and sour cherry compote.",
      "Üstü yanık, ortası akışkan cheesecake, yanında vişne komposto.",
    ),
    story: t("Burnt on purpose: the dark top, the molten centre.", "Bilerek yakılır: koyu bir üst, akışkan bir orta."),
  },
  {
    slug: "chocolate-fondant", category: "desserts", price: 480, allergens: ["eggs", "milk", "gluten", "sesame"], dietary: ["vegetarian"],
    name: t("Dark chocolate fondant, tahini ice cream", "Bitter çikolatalı fondan, tahinli dondurma"),
    description: t(
      "Warm dark chocolate fondant with tahini ice cream and sea salt.",
      "Sıcak bitter çikolatalı fondan, tahinli dondurma ve deniz tuzu.",
    ),
    story: t(
      "Baked to order, so give it twelve minutes. It is worth the wait.",
      "Siparişle pişer, on iki dakika verin. Beklemeye değer.",
    ),
  },
  {
    slug: "pistachio-baklava", category: "desserts", price: 440, allergens: ["gluten", "nuts", "milk"], dietary: ["vegetarian"],
    name: t("Pistachio baklava, kaymak", "Fıstıklı baklava, kaymak"),
    description: t(
      "Crisp baklava with Antep pistachios and a spoon of fresh kaymak.",
      "Antep fıstıklı çıtır baklava ve bir kaşık taze kaymak.",
    ),
    story: t(
      "Thirty-six layers of hand-rolled pastry, finished with a cloud of kaymak.",
      "El açması otuz altı kat yufka, üzerinde bir bulut kaymak.",
    ),
  },
  {
    slug: "olive-oil-gelato", category: "desserts", price: 360, allergens: ["milk", "eggs"], dietary: ["vegetarian", "gluten-free"],
    name: t("Olive oil gelato, sea salt", "Zeytinyağlı dondurma, deniz tuzu"),
    description: t(
      "Three scoops of olive oil gelato with flaky sea salt and a thread of honey.",
      "Üç top zeytinyağlı dondurma, tuz pulları ve bir damla bal.",
    ),
    story: t(
      "Churned each morning with Aegean olive oil, finished with salt at the table.",
      "Her sabah Ege zeytinyağıyla çalkalanır, masada tuzla tamamlanır.",
    ),
  },
  // Cocktails
  {
    slug: "lodos-negroni", category: "cocktails", price: 680, allergens: [], dietary: ["vegan", "gluten-free"],
    name: t("Lodos Negroni", "Lodos Negroni"),
    description: t(
      "Gin, bitter red aperitivo and sweet vermouth, barrel rested and served over a large cube.",
      "Cin, acı kırmızı aperitif ve tatlı vermut, fıçıda dinlendirilir, büyük bir buzla servis edilir.",
    ),
    story: t(
      "Our house Negroni rests in a barrel for three weeks, until the bitterness turns to velvet.",
      "Ev Negronimiz üç hafta fıçıda dinlenir, acılığı kadifeye dönene kadar.",
    ),
    groups: [
      {
        id: "gin", name: t("Gin", "Cin"), type: "single", required: true,
        options: [
          { id: "london-dry", name: t("London dry", "London dry"), delta: 0 },
          { id: "barrel-aged", name: t("Barrel-aged gin", "Fıçıda dinlenmiş cin"), delta: 90 },
          { id: "mastic", name: t("Mastic gin", "Sakızlı cin"), delta: 60 },
        ],
      },
    ],
  },
  {
    slug: "espresso-martini", category: "cocktails", price: 640, allergens: [], dietary: ["vegan", "gluten-free"],
    name: t("Cardamom espresso martini", "Kakuleli espresso martini"),
    description: t(
      "Vodka, double espresso, coffee liqueur and cardamom syrup, shaken hard.",
      "Votka, çift espresso, kahve likörü ve kakule şurubu, sert çalkalanır.",
    ),
    story: t(
      "Shaken until the crema is thick and pale, then finished with three coffee beans.",
      "Köpüğü kalın ve açık renkli olana kadar çalkalanır, üç kahve çekirdeğiyle bitirilir.",
    ),
  },
  {
    slug: "margarita", category: "cocktails", price: 660, allergens: [], dietary: ["vegan", "gluten-free"],
    name: t("Smoked chili margarita", "Füme acılı margarita"),
    description: t(
      "Tequila, mezcal, fresh lime and agave, with a smoked chili salt rim.",
      "Tekila, mezkal, taze limon ve agave, füme acı biberli tuz kenarlı.",
    ),
    story: t(
      "It arrives quietly and bites back.",
      "Sessizce gelir, ısırır.",
    ),
  },
  {
    slug: "old-fashioned", category: "cocktails", price: 700, allergens: ["nuts"], dietary: ["vegan", "gluten-free"],
    name: t("Fig old fashioned", "İncirli old fashioned"),
    description: t(
      "Bourbon stirred with fig syrup and walnut bitters over one large clear cube.",
      "Burbon, incir şurubu ve ceviz bitteriyle karıştırılır, tek bir büyük berrak buzla servis edilir.",
    ),
    story: t(
      "Stirred for a full minute at the bar and finished with an orange peel flamed at your table.",
      "Barda tam bir dakika karıştırılır, portakal kabuğu masanızda alevlendirilir.",
    ),
  },
  {
    slug: "spritz", category: "cocktails", price: 600, allergens: ["sulphites"], dietary: ["vegan", "gluten-free"],
    name: t("Bergamot spritz", "Bergamotlu spritz"),
    description: t(
      "Bergamot liqueur, dry sparkling wine and soda, with an orange slice.",
      "Bergamot likörü, sek köpüklü şarap ve soda, yanında portakal dilimi.",
    ),
    story: t(
      "A Karaköy sunset in a glass, best on the terrace around seven.",
      "Bir bardakta Karaköy gün batımı, en güzeli akşam yedide teras.",
    ),
  },
  // Wine
  {
    slug: "red-wine-glass", category: "wine", price: 440, allergens: ["sulphites"], dietary: ["vegan"],
    name: t("Kalecik Karası, by the glass", "Kalecik Karası, kadeh"),
    description: t(
      "Bright cherry, soft tannins and a little spice, from the Ankara highlands.",
      "Parlak vişne, yumuşak tanen ve hafif baharat, Ankara yaylalarından.",
    ),
    story: t(
      "A Turkish grape that suits fish and fire alike, and tastes better slightly chilled.",
      "Hem balığa hem ateşe yakışan yerli bir üzüm, hafif soğuk içildiğinde daha güzel.",
    ),
    groups: [wineSize(220)],
  },
  {
    slug: "rose-wine", category: "wine", price: 420, allergens: ["sulphites"], dietary: ["vegan"],
    name: t("Dry rosé, by the glass", "Sek roze, kadeh"),
    description: t(
      "Pale, dry and mineral, with wild strawberry and citrus peel.",
      "Soluk renkli, sek ve mineral, yaban çileği ve narenciye kabuğu notalarıyla.",
    ),
    story: t(
      "From the Aegean coast. It disappears quickly when oysters are on the table.",
      "Ege kıyısından. Masada istiridye varsa çabuk biter.",
    ),
    groups: [wineSize(210)],
  },
  {
    slug: "sparkling", category: "wine", price: 520, allergens: ["sulphites"], dietary: ["vegan"],
    name: t("Narince pét-nat, by the glass", "Narince pét-nat, kadeh"),
    description: t(
      "Cloudy, lively and dry, with green apple and a saline finish.",
      "Bulanık, canlı ve sek, yeşil elma ve tuzlu bir bitişle.",
    ),
    story: t(
      "Bottled mid-ferment in Tokat, so it keeps a little wildness.",
      "Tokat'ta fermantasyon sürerken şişelenir, biraz vahşi kalır.",
    ),
    groups: [wineSize(260)],
  },
  // Zero-proof
  {
    slug: "mint-lemonade", category: "zero", price: 320, allergens: [], dietary: ["vegan", "gluten-free"],
    name: t("Mint and salt lemonade", "Naneli tuzlu limonata"),
    description: t(
      "Fresh lemon, muddled mint and a pinch of sea salt over crushed ice.",
      "Taze limon, ezilmiş nane ve bir tutam deniz tuzu, kırılmış buz üzerinde.",
    ),
    story: t("Squeezed to order, never from a bottle.", "Siparişle sıkılır, asla şişeden gelmez."),
  },
  {
    slug: "tonic-garden", category: "zero", price: 340, allergens: [], dietary: ["vegan", "gluten-free"],
    name: t("Garden tonic", "Bahçe tonik"),
    description: t(
      "House tonic, cucumber ribbons, juniper and rosemary.",
      "Ev yapımı tonik, salatalık şeritleri, ardıç ve biberiye.",
    ),
    story: t(
      "A long drink for people who are not drinking and do not want to be reminded of it.",
      "İçmeyenler için uzun bir içecek, kimse bunu hatırlatmasın diye.",
    ),
  },
  {
    slug: "cold-brew", category: "zero", price: 300, allergens: [], dietary: ["vegan", "gluten-free"],
    name: t("Cold brew, orange peel", "Soğuk demleme, portakal kabuğu"),
    description: t(
      "Eighteen-hour cold brew over a large block of ice with orange peel.",
      "On sekiz saat demlenmiş soğuk kahve, büyük bir buz ve portakal kabuğuyla.",
    ),
    story: t("Steeped overnight and poured at the bar.", "Bir gece demlenir ve barda servis edilir."),
  },
];

export const ROOMS = [
  { key: "salon", name: "Salon", sort: 0 },
  { key: "bar", name: "Bar", sort: 1 },
  { key: "terrace", name: "Terrace", sort: 2 },
] as const;

/** Floor positions in a ~740 x 420 canvas, matching the floor mockup's feel. `section` is the waiter key. */
type TableSpec = {
  name: string; room: "salon" | "bar" | "terrace"; shape: "round" | "rect";
  x: number; y: number; w: number; h: number; capacity: number; section: "waiter" | "waiter2";
};
const booth = (n: number, x: number, section: "waiter" | "waiter2", capacity = 4): TableSpec =>
  ({ name: `B${n}`, room: "salon", shape: "rect", x, y: 51, w: 92, h: 52, capacity, section });
const rnd = (name: string, room: TableSpec["room"], x: number, y: number, capacity: number, section: "waiter" | "waiter2", d = 76): TableSpec =>
  ({ name, room, shape: "round", x, y, w: d, h: d, capacity, section });

export const TABLES: TableSpec[] = [
  booth(1, 30, "waiter"), booth(2, 176, "waiter", 2), booth(3, 321, "waiter"), booth(4, 467, "waiter2", 3), booth(5, 612, "waiter2", 2),
  rnd("T1", "salon", 40, 162, 2, "waiter2"), rnd("T2", "salon", 160, 162, 2, "waiter2"), rnd("T3", "salon", 280, 162, 2, "waiter2"),
  rnd("T4", "salon", 400, 162, 4, "waiter2", 88), rnd("T5", "salon", 530, 162, 2, "waiter"), rnd("T6", "salon", 640, 162, 2, "waiter"),
  rnd("T7", "salon", 200, 298, 2, "waiter"), rnd("T8", "salon", 340, 298, 4, "waiter", 88),
  rnd("T9", "bar", 60, 120, 2, "waiter", 64), rnd("T10", "bar", 190, 120, 2, "waiter", 64),
  rnd("T11", "bar", 320, 120, 2, "waiter2", 64), rnd("T12", "bar", 450, 120, 2, "waiter2", 64),
  rnd("T13", "terrace", 60, 90, 4, "waiter", 76), rnd("T14", "terrace", 220, 90, 4, "waiter", 76),
  rnd("T15", "terrace", 380, 90, 4, "waiter2", 76), rnd("T16", "terrace", 540, 90, 6, "waiter2", 88),
];

/** Accounts that sign in. `demoProtected`: the demo role buttons use them, so in demo mode they can't be deactivated. */
export const STAFF = [
  { key: "waiter", name: "Deniz", role: "waiter", pin: "1111", demoProtected: true },
  { key: "waiter2", name: "Mert", role: "waiter", pin: "2222", demoProtected: false },
  { key: "kitchen", name: "Kitchen", role: "kitchen", pin: "3333", demoProtected: true },
  { key: "bar", name: "Bar", role: "bar", pin: "4444", demoProtected: true },
  { key: "manager", name: "Selin", role: "manager", pin: "9999", demoProtected: true },
] as const;

/** Schedule-only people (no PIN, can't sign in): the cooks, bartenders, host and dishwasher. All names are fictional. */
export const SCHEDULE_TEAM = [
  { name: "Emre Yıldız", role: "cook" },
  { name: "Zeynep Arslan", role: "cook" },
  { name: "Burak Şahin", role: "cook" },
  { name: "Ece Demir", role: "bartender" },
  { name: "Can Özkan", role: "bartender" },
  { name: "İpek Aydın", role: "host" },
  { name: "Hasan Kılıç", role: "dishwasher" },
] as const;

/** Shift presets (spec §6.2), in display order. */
export const SHIFT_TEMPLATES: readonly { name: string; start: string; end: string; area: ShiftArea }[] = [
  { name: "Dinner", start: "17:00", end: "01:00", area: "salon" },
  { name: "Prep", start: "12:00", end: "17:00", area: "kitchen" },
  { name: "Double", start: "12:00", end: "01:00", area: "salon" },
  { name: "Bar", start: "18:00", end: "02:00", area: "bar" },
];

/**
 * The demo schedule: this week (0) and next (1), relative to `now`. `days` are offsets from Monday. Everyone works
 * 4-5 shifts a week, one per service day at the same times, so rest is always over 11 h (also across the two weeks).
 * The one deliberate warning (spec §6.5): Ece Demir works 47 h this week (4 × 10 h + 7 h). Nobody else is warned.
 */
export const SEED_SHIFTS: readonly {
  name: string;
  weeks: readonly (0 | 1)[];
  days: readonly number[];
  start: string;
  end: string;
  area: ShiftArea;
  note?: string;
}[] = [
  { name: "Deniz", weeks: [0, 1], days: [0, 1, 3, 4, 5], start: "17:00", end: "01:00", area: "salon" },
  { name: "Mert", weeks: [0, 1], days: [2, 3, 4, 5, 6], start: "17:00", end: "01:00", area: "terrace" },
  { name: "İpek Aydın", weeks: [0, 1], days: [3, 4, 5, 6], start: "18:00", end: "23:00", area: "salon" },
  { name: "Emre Yıldız", weeks: [0, 1], days: [0, 1, 2, 3, 4], start: "13:00", end: "21:00", area: "kitchen" },
  { name: "Zeynep Arslan", weeks: [0, 1], days: [2, 3, 4, 5, 6], start: "16:00", end: "00:00", area: "kitchen" },
  { name: "Burak Şahin", weeks: [0, 1], days: [1, 2, 4, 5], start: "12:00", end: "17:00", area: "kitchen" },
  { name: "Ece Demir", weeks: [0], days: [2, 3, 4, 5], start: "16:00", end: "02:00", area: "bar" },
  { name: "Ece Demir", weeks: [0], days: [6], start: "18:00", end: "01:00", area: "bar" },
  { name: "Ece Demir", weeks: [1], days: [1, 2, 4, 5, 6], start: "18:00", end: "02:00", area: "bar" },
  { name: "Can Özkan", weeks: [0, 1], days: [0, 1, 3, 6], start: "18:00", end: "02:00", area: "bar" },
  { name: "Hasan Kılıç", weeks: [0, 1], days: [0, 2, 4, 5, 6], start: "17:00", end: "01:00", area: "kitchen" },
  { name: "Selin", weeks: [0, 1], days: [0, 1, 3, 5], start: "15:00", end: "23:00", area: "salon" },
  { name: "Selin", weeks: [0, 1], days: [4], start: "15:00", end: "23:00", area: "salon", note: "Stock count" },
];
