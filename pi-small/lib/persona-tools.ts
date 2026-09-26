/**
 * persona-tools.ts — the tools the persona can call (persona mode only). See
 * persona/DESIGN.md, "Tools, and replies that come later".
 *
 * Depends on pi's tool types (typebox), so it stays on the plugin side of the
 * line lib/roster.ts and lib/persona.ts keep: those two must load under plain
 * node.
 *
 * Every tool here:
 *  - is read-only and talks only to a fixed service — the persona runs
 *    uncontained, so nothing here may touch files or run commands;
 *  - has its own timeout, so a slow network turns into an error the model can
 *    say something about instead of a stalled conversation;
 *  - returns short plain text meant for the model to read and retell, not JSON.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";

const TOOL_TIMEOUT_MS = Number(process.env.PI_SMALL_PERSONA_TOOL_TIMEOUT ?? 15) * 1000;
/** Open-Meteo's two hosts; overridable so tests never touch the network. */
const WEATHER_API = process.env.PI_SMALL_WEATHER_API ?? "https://api.open-meteo.com";
const GEOCODING_API = process.env.PI_SMALL_GEOCODING_API ?? "https://geocoding-api.open-meteo.com";

export interface PersonaConfig {
	/** Where "here" is, for tools that need a place when none is named. */
	home?: { name?: string; latitude: number; longitude: number };
}

/** $PI_SMALL_PERSONA_HOME/config.json, or {} when there is none. */
export function readPersonaConfig(home: string): PersonaConfig {
	const path = join(home, "config.json");
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {};
	}
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

async function getJson(url: string, signal?: AbortSignal): Promise<any> {
	const timeout = AbortSignal.timeout(TOOL_TIMEOUT_MS);
	const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

// ------------------------------------------------------------------ weather --

/** WMO weather interpretation codes, as Open-Meteo reports them. */
const WMO: Record<number, string> = {
	0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
	45: "fog", 48: "freezing fog",
	51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "light freezing drizzle", 57: "freezing drizzle",
	61: "light rain", 63: "rain", 65: "heavy rain", 66: "light freezing rain", 67: "freezing rain",
	71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
	80: "light showers", 81: "showers", 82: "violent showers", 85: "light snow showers", 86: "snow showers",
	95: "thunderstorm", 96: "thunderstorm with light hail", 99: "thunderstorm with hail",
};
const describe = (code: unknown) => WMO[Number(code)] ?? `weather code ${code}`;
const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatWeather(place: string, data: any): string {
	const lines = [`Weather for ${place}.`];
	const c = data?.current;
	if (c) {
		lines.push(`Now: ${describe(c.weather_code)}, ${Math.round(c.temperature_2m)} degrees Celsius, wind ${Math.round(c.wind_speed_10m)} km/h.`);
	}
	const d = data?.daily;
	if (d?.time) {
		d.time.forEach((date: string, i: number) => {
			const day = i === 0 ? "Today" : i === 1 ? "Tomorrow" : DAY[new Date(`${date}T12:00:00`).getDay()];
			lines.push(
				`${day} (${date}): ${describe(d.weather_code?.[i])}, ${Math.round(d.temperature_2m_min?.[i])} to ${Math.round(d.temperature_2m_max?.[i])} degrees, ` +
					`${d.precipitation_probability_max?.[i] ?? "?"} percent chance of rain.`,
			);
		});
	}
	return lines.join("\n");
}

function weatherTool(config: PersonaConfig) {
	return {
		name: "weather",
		label: "weather",
		description:
			"Current weather and the forecast for the next three days. Without a place it uses home" +
			(config.home?.name ? ` (${config.home.name})` : "") +
			". Takes a few seconds.",
		parameters: Type.Object({
			place: Type.Optional(Type.String({ description: "a town or city; leave out for home" })),
		}),
		async execute(_id: string, params: any, signal?: AbortSignal) {
			try {
				let lat: number;
				let lon: number;
				let name: string;
				const place = typeof params?.place === "string" ? params.place.trim() : "";
				if (place) {
					const g = await getJson(`${GEOCODING_API}/v1/search?count=1&language=en&name=${encodeURIComponent(place)}`, signal);
					const hit = g?.results?.[0];
					if (!hit) return text(`No place called "${place}" was found.`);
					lat = hit.latitude;
					lon = hit.longitude;
					name = [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ");
				} else if (config.home) {
					lat = config.home.latitude;
					lon = config.home.longitude;
					name = config.home.name ?? "home";
				} else {
					return text("No home location is configured, so a place has to be named.");
				}
				const q =
					`latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=3` +
					"&current=temperature_2m,weather_code,wind_speed_10m" +
					"&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max";
				return text(formatWeather(name, await getJson(`${WEATHER_API}/v1/forecast?${q}`, signal)));
			} catch (e: any) {
				const why = e?.name === "TimeoutError" ? "the weather service did not answer in time" : `the weather service failed (${e?.message ?? e})`;
				return text(`Could not get the weather: ${why}.`);
			}
		},
	};
}

// ----------------------------------------------------------------- registry --

const FACTORIES: Record<string, (config: PersonaConfig) => any> = {
	weather: weatherTool,
};

export const PERSONA_TOOL_NAMES = Object.keys(FACTORIES);

/** Tool definitions for the named persona tools; unknown names are reported, not fatal. */
export function buildPersonaTools(names: string[], config: PersonaConfig): { tools: any[]; unknown: string[] } {
	const tools: any[] = [];
	const unknown: string[] = [];
	for (const n of names) {
		const f = FACTORIES[n];
		if (f) tools.push(f(config));
		else unknown.push(n);
	}
	return { tools, unknown };
}
