import { langMap } from "./languageMap.ts";

type TranslationLanguageEntry = {
	value: string;
	englishName: string;
	turkishName: string;
	search: string;
};

export type TranslationLanguageChoice = {
	name: string;
	value: string;
	name_localizations: {
		tr: string;
		"en-US": string;
	};
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
			normalizeSearch(entry.englishName) === normalizedSearch ||
			normalizeSearch(entry.turkishName) === normalizedSearch ||
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
		const englishName = entry.englishName;
		const turkishName = entry.turkishName;

		return {
			name: isEnglishLocale(locale) ? englishName : turkishName,
			name_localizations: {
				tr: turkishName,
				"en-US": englishName,
			},
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
			const englishName = ENGLISH_LANGUAGE_DISPLAY_NAMES[entry.value] ?? toTitleCase(entry.value);
			const turkishName = TURKISH_LANGUAGE_DISPLAY_NAMES[entry.value] ?? englishName;
			return {
				value: entry.value,
				englishName,
				turkishName,
				search: normalizeSearch([englishName, turkishName, entry.value, ...entry.aliases].join(" ")),
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

			return left.turkishName.localeCompare(right.turkishName);
		});
}

function isEnglishLocale(locale: string) {
	return locale.toLowerCase().startsWith("en");
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
