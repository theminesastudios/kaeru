import { langMap } from "./languageMap.js";

type TranslationLanguageEntry = {
	value: string;
	names: Record<string, string>;
	search: string;
};

export type TranslationLanguageChoice = {
	name: string;
	value: string;
	name_localizations: Record<string, string>;
};

const POPULAR_LANGUAGE_VALUES = [
	"turkish",
	"english",
	"german",
	"french",
	"spanish",
	"italian",
	"portuguese",
	"russian",
	"arabic",
	"japanese",
	"korean",
	"chinese",
	"dutch",
	"polish",
	"romanian",
	"ukrainian",
	"greek",
	"hindi",
	"indonesian",
	"persian",
	"azerbaijani",
	"kazakh",
	"urdu",
	"vietnamese",
	"swedish",
];

const EXTRA_LANGUAGE_ALIASES: Record<string, string[]> = {
	arabic: ["arapca"],
	azerbaijani: ["azerice", "azerbaycanca"],
	chinese: ["cince"],
	english: ["ingilizce"],
	french: ["fransizca"],
	german: ["almanca"],
	greek: ["yunanca"],
	italian: ["italyanca"],
	japanese: ["japonca"],
	korean: ["korece"],
	portuguese: ["portekizce"],
	romanian: ["romence"],
	russian: ["rusca"],
	spanish: ["ispanyolca"],
	turkish: ["turkce", "turk"],
	ukrainian: ["ukraynaca"],
};

const ENGLISH_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Arabic",
	azerbaijani: "Azerbaijani",
	chinese: "Chinese",
	dutch: "Nederlands",
	english: "English",
	french: "French",
	german: "Deutsch",
	greek: "Greek",
	hindi: "Hindi",
	indonesian: "Bahasa Indonesia",
	italian: "Italiano",
	japanese: "Japanese",
	kazakh: "Kazakh",
	korean: "Korean",
	persian: "Persian",
	polish: "Polski",
	portuguese: "Portuguese",
	romanian: "Romanian",
	russian: "Russian",
	spanish: "Spanish",
	swedish: "Svenska",
	turkish: "Turkish",
	ukrainian: "Ukrainian",
	urdu: "Urdu",
	vietnamese: "Vietnamese",
};

const TURKISH_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Arapça",
	azerbaijani: "Azerice",
	chinese: "Çince",
	dutch: "Felemenkçe",
	english: "İngilizce",
	french: "Fransızca",
	german: "Almanca",
	greek: "Yunanca",
	hindi: "Hintçe",
	indonesian: "Endonezce",
	italian: "İtalyanca",
	japanese: "Japonca",
	kazakh: "Kazakça",
	korean: "Korece",
	persian: "Farsça",
	polish: "Lehçe",
	portuguese: "Portekizce",
	romanian: "Romence",
	russian: "Rusça",
	spanish: "İspanyolca",
	swedish: "İsveççe",
	turkish: "Türkçe",
	ukrainian: "Ukraynaca",
	urdu: "Urduca",
	vietnamese: "Vietnamca",
};

const PORTUGUESE_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Árabe",
	azerbaijani: "Azerbaijano",
	chinese: "Chinês",
	dutch: "Holandês",
	english: "Inglês",
	french: "Francês",
	german: "Alemão",
	greek: "Grego",
	hindi: "Hindi",
	indonesian: "Indonésio",
	italian: "Italiano",
	japanese: "Japonês",
	kazakh: "Cazaque",
	korean: "Coreano",
	persian: "Persa",
	polish: "Polonês",
	portuguese: "Português",
	romanian: "Romeno",
	russian: "Russo",
	spanish: "Espanhol",
	swedish: "Sueco",
	turkish: "Turco",
	ukrainian: "Ucraniano",
	urdu: "Urdu",
	vietnamese: "Vietnamita",
};

const ITALIAN_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Arabo",
	azerbaijani: "Azero",
	chinese: "Cinese",
	dutch: "Olandese",
	english: "Inglese",
	french: "Francese",
	german: "Tedesco",
	greek: "Greco",
	hindi: "Hindi",
	indonesian: "Indonesiano",
	italian: "Italiano",
	japanese: "Giapponese",
	kazakh: "Kazako",
	korean: "Coreano",
	persian: "Persiano",
	polish: "Polacco",
	portuguese: "Portoghese",
	romanian: "Rumeno",
	russian: "Russo",
	spanish: "Spagnolo",
	swedish: "Svedese",
	turkish: "Turco",
	ukrainian: "Ucraino",
	urdu: "Urdu",
	vietnamese: "Vietnamita",
};

const GERMAN_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Arabisch",
	azerbaijani: "Aserbaidschanisch",
	chinese: "Chinesisch",
	dutch: "Niederländisch",
	english: "Englisch",
	french: "Französisch",
	german: "Deutsch",
	greek: "Griechisch",
	hindi: "Hindi",
	indonesian: "Indonesisch",
	italian: "Italienisch",
	japanese: "Japanisch",
	kazakh: "Kasachisch",
	korean: "Koreanisch",
	persian: "Persisch",
	polish: "Polnisch",
	portuguese: "Portugiesisch",
	romanian: "Rumänisch",
	russian: "Russisch",
	spanish: "Spanisch",
	swedish: "Schwedisch",
	turkish: "Türkisch",
	ukrainian: "Ukrainisch",
	urdu: "Urdu",
	vietnamese: "Vietnamesisch",
};

const SPANISH_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Árabe",
	azerbaijani: "Azerí",
	chinese: "Chino",
	dutch: "Neerlandés",
	english: "Inglés",
	french: "Francés",
	german: "Alemán",
	greek: "Griego",
	hindi: "Hindi",
	indonesian: "Indonesio",
	italian: "Italiano",
	japanese: "Japonés",
	kazakh: "Kazajo",
	korean: "Coreano",
	persian: "Persa",
	polish: "Polaco",
	portuguese: "Portugués",
	romanian: "Rumano",
	russian: "Ruso",
	spanish: "Español",
	swedish: "Sueco",
	turkish: "Turco",
	ukrainian: "Ucraniano",
	urdu: "Urdu",
	vietnamese: "Vietnamita",
};

const FRENCH_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Arabe",
	azerbaijani: "Azerbaïdjanais",
	chinese: "Chinois",
	dutch: "Néerlandais",
	english: "Anglais",
	french: "Français",
	german: "Allemand",
	greek: "Grec",
	hindi: "Hindi",
	indonesian: "Indonésien",
	italian: "Italien",
	japanese: "Japonais",
	kazakh: "Kazakh",
	korean: "Coréen",
	persian: "Persan",
	polish: "Polonais",
	portuguese: "Portugais",
	romanian: "Roumain",
	russian: "Russe",
	spanish: "Espagnol",
	swedish: "Suédois",
	turkish: "Turc",
	ukrainian: "Ukrainien",
	urdu: "Ourdou",
	vietnamese: "Vietnamien",
};

const ROMANIAN_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Arabă",
	azerbaijani: "Azeră",
	chinese: "Chineză",
	dutch: "Neerlandeză",
	english: "Engleză",
	french: "Franceză",
	german: "Germană",
	greek: "Greacă",
	hindi: "Hindi",
	indonesian: "Indoneziană",
	italian: "Italiană",
	japanese: "Japoneză",
	kazakh: "Kazahă",
	korean: "Coreeană",
	persian: "Persană",
	polish: "Poloneză",
	portuguese: "Portugheză",
	romanian: "Română",
	russian: "Rusă",
	spanish: "Spaniolă",
	swedish: "Suedeză",
	turkish: "Turcă",
	ukrainian: "Ucraineană",
	urdu: "Urdu",
	vietnamese: "Vietnameză",
};

const GREEK_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Αραβικά",
	azerbaijani: "Αζερικά",
	chinese: "Κινεζικά",
	dutch: "Ολλανδικά",
	english: "Αγγλικά",
	french: "Γαλλικά",
	german: "Γερμανικά",
	greek: "Ελληνικά",
	hindi: "Χίντι",
	indonesian: "Ινδονησιακά",
	italian: "Ιταλικά",
	japanese: "Ιαπωνικά",
	kazakh: "Καζακικά",
	korean: "Κορεατικά",
	persian: "Περσικά",
	polish: "Πολωνικά",
	portuguese: "Πορτογαλικά",
	romanian: "Ρουμανικά",
	russian: "Ρωσικά",
	spanish: "Ισπανικά",
	swedish: "Σουηδικά",
	turkish: "Τουρκικά",
	ukrainian: "Ουκρανικά",
	urdu: "Ουρντού",
	vietnamese: "Βιετναμικά",
};

const RUSSIAN_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "Арабский",
	azerbaijani: "Азербайджанский",
	chinese: "Китайский",
	dutch: "Нидерландский",
	english: "Английский",
	french: "Французский",
	german: "Немецкий",
	greek: "Греческий",
	hindi: "Хинди",
	indonesian: "Индонезийский",
	italian: "Итальянский",
	japanese: "Японский",
	kazakh: "Казахский",
	korean: "Корейский",
	persian: "Персидский",
	polish: "Польский",
	portuguese: "Португальский",
	romanian: "Румынский",
	russian: "Русский",
	spanish: "Испанский",
	swedish: "Шведский",
	turkish: "Турецкий",
	ukrainian: "Украинский",
	urdu: "Урду",
	vietnamese: "Вьетнамский",
};

const SIMPLIFIED_CHINESE_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "阿拉伯语",
	azerbaijani: "阿塞拜疆语",
	chinese: "中文",
	dutch: "荷兰语",
	english: "英语",
	french: "法语",
	german: "德语",
	greek: "希腊语",
	hindi: "印地语",
	indonesian: "印尼语",
	italian: "意大利语",
	japanese: "日语",
	kazakh: "哈萨克语",
	korean: "韩语",
	persian: "波斯语",
	polish: "波兰语",
	portuguese: "葡萄牙语",
	romanian: "罗马尼亚语",
	russian: "俄语",
	spanish: "西班牙语",
	swedish: "瑞典语",
	turkish: "土耳其语",
	ukrainian: "乌克兰语",
	urdu: "乌尔都语",
	vietnamese: "越南语",
};

const JAPANESE_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "アラビア語",
	azerbaijani: "アゼルバイジャン語",
	chinese: "中国語",
	dutch: "オランダ語",
	english: "英語",
	french: "フランス語",
	german: "ドイツ語",
	greek: "ギリシャ語",
	hindi: "ヒンディー語",
	indonesian: "インドネシア語",
	italian: "イタリア語",
	japanese: "日本語",
	kazakh: "カザフ語",
	korean: "韓国語",
	persian: "ペルシア語",
	polish: "ポーランド語",
	portuguese: "ポルトガル語",
	romanian: "ルーマニア語",
	russian: "ロシア語",
	spanish: "スペイン語",
	swedish: "スウェーデン語",
	turkish: "トルコ語",
	ukrainian: "ウクライナ語",
	urdu: "ウルドゥー語",
	vietnamese: "ベトナム語",
};

const KOREAN_LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	arabic: "아랍어",
	azerbaijani: "아제르바이잔어",
	chinese: "중국어",
	dutch: "네덜란드어",
	english: "영어",
	french: "프랑스어",
	german: "독일어",
	greek: "그리스어",
	hindi: "힌디어",
	indonesian: "인도네시아어",
	italian: "이탈리아어",
	japanese: "일본어",
	kazakh: "카자흐어",
	korean: "한국어",
	persian: "페르시아어",
	polish: "폴란드어",
	portuguese: "포르투갈어",
	romanian: "루마니아어",
	russian: "러시아어",
	spanish: "스페인어",
	swedish: "스웨덴어",
	turkish: "터키어",
	ukrainian: "우크라이나어",
	urdu: "우르두어",
	vietnamese: "베트남어",
};

const LOCALE_LANGUAGE_DISPLAY_NAMES: Record<string, Record<string, string>> = {
	tr: TURKISH_LANGUAGE_DISPLAY_NAMES,
	"en-US": ENGLISH_LANGUAGE_DISPLAY_NAMES,
	"pt-BR": PORTUGUESE_LANGUAGE_DISPLAY_NAMES,
	it: ITALIAN_LANGUAGE_DISPLAY_NAMES,
	de: GERMAN_LANGUAGE_DISPLAY_NAMES,
	"es-ES": SPANISH_LANGUAGE_DISPLAY_NAMES,
	fr: FRENCH_LANGUAGE_DISPLAY_NAMES,
	ro: ROMANIAN_LANGUAGE_DISPLAY_NAMES,
	el: GREEK_LANGUAGE_DISPLAY_NAMES,
	ru: RUSSIAN_LANGUAGE_DISPLAY_NAMES,
	"zh-CN": SIMPLIFIED_CHINESE_LANGUAGE_DISPLAY_NAMES,
	ja: JAPANESE_LANGUAGE_DISPLAY_NAMES,
	ko: KOREAN_LANGUAGE_DISPLAY_NAMES,
};

export function resolveTranslationLanguage(language: string) {
	const normalized = language.trim();
	const key = normalized.toLowerCase().replaceAll("_", "-");
	const value = langMap[key] || langMap[key.split("-")[0]];

	if (value) {
		return value;
	}

	const normalizedSearch = normalizeSearch(normalized);
	const match = TRANSLATION_LANGUAGE_ENTRIES.find(
		(entry) =>
			Object.values(entry.names).some((name) => normalizeSearch(name) === normalizedSearch) ||
			normalizeSearch(entry.value) === normalizedSearch ||
			entry.search.split(" ").includes(normalizedSearch),
	);

	return match?.value ?? normalized;
}

export function getTranslationLanguageChoices(query = "", limit = 25, locale = "tr") {
	const normalizedQuery = normalizeSearch(query);
	const entries = normalizedQuery
		? TRANSLATION_LANGUAGE_ENTRIES.filter((entry) => entry.search.includes(normalizedQuery))
		: TRANSLATION_LANGUAGE_ENTRIES;

	return entries.slice(0, Math.min(limit, 25)).map<TranslationLanguageChoice>((entry) => {
		const localizations = buildChoiceLocalizations(entry);

		return {
			name: localizations[resolveChoiceLocale(locale)] ?? localizations.tr,
			name_localizations: localizations,
			value: entry.value,
		};
	});
}

const TRANSLATION_LANGUAGE_ENTRIES = buildTranslationLanguageEntries();

function buildTranslationLanguageEntries() {
	const entriesByValue = new Map<string, { value: string; aliases: Set<string> }>();

	for (const [code, value] of Object.entries(langMap)) {
		const entry = entriesByValue.get(value) ?? {
			value,
			aliases: new Set<string>(),
		};

		entry.aliases.add(code);
		entry.aliases.add(code.replaceAll("_", "-"));
		entry.aliases.add(value);
		entry.aliases.add(toTitleCase(value));
		for (const alias of EXTRA_LANGUAGE_ALIASES[value] ?? []) {
			entry.aliases.add(alias);
		}
		entriesByValue.set(value, entry);
	}

	return [...entriesByValue.values()]
		.map<TranslationLanguageEntry>((entry) => {
			const names = buildLanguageNames(entry.value);
			return {
				value: entry.value,
				names,
				search: normalizeSearch([...Object.values(names), entry.value, ...entry.aliases].join(" ")),
			};
		})
		.sort((left, right) => {
			const leftPopularIndex = POPULAR_LANGUAGE_VALUES.indexOf(left.value);
			const rightPopularIndex = POPULAR_LANGUAGE_VALUES.indexOf(right.value);

			if (leftPopularIndex !== -1 || rightPopularIndex !== -1) {
				return (
					(leftPopularIndex === -1 ? Number.MAX_SAFE_INTEGER : leftPopularIndex) -
					(rightPopularIndex === -1 ? Number.MAX_SAFE_INTEGER : rightPopularIndex)
				);
			}

			return left.names.tr.localeCompare(right.names.tr);
		});
}

function buildLanguageNames(value: string) {
	const englishName = ENGLISH_LANGUAGE_DISPLAY_NAMES[value] ?? toTitleCase(value);

	return Object.fromEntries(
		Object.entries(LOCALE_LANGUAGE_DISPLAY_NAMES).map(([locale, displayNames]) => [
			locale,
			displayNames[value] ?? englishName,
		]),
	) as Record<string, string>;
}

function buildChoiceLocalizations(entry: TranslationLanguageEntry) {
	return Object.fromEntries(
		Object.keys(LOCALE_LANGUAGE_DISPLAY_NAMES).map((locale) => [locale, entry.names[locale]]),
	) as Record<string, string>;
}

function resolveChoiceLocale(locale: string) {
	if (locale in LOCALE_LANGUAGE_DISPLAY_NAMES) {
		return locale;
	}

	const baseLocale = locale.split("-")[0];
	if (baseLocale in LOCALE_LANGUAGE_DISPLAY_NAMES) {
		return baseLocale;
	}

	return "tr";
}

function normalizeSearch(value: string) {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replaceAll("_", "-")
		.replace(/[^a-z0-9 -]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function toTitleCase(value: string) {
	return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
