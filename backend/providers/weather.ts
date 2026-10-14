import { z } from 'zod';

const temperatureSchema = z.object({
  updateTime: z.string().datetime({ offset: true }),
  temperature: z.object({
    recordTime: z.string().datetime({ offset: true }).optional(),
    data: z.array(z.object({ place: z.string(), value: z.number().finite(), unit: z.string() })),
  }),
  rainfall: z.object({
    startTime: z.string().datetime({ offset: true }),
    endTime: z.string().datetime({ offset: true }),
    data: z.array(
      z.object({
        place: z.string(),
        max: z.number().finite().nonnegative(),
        unit: z.string().optional(),
      }),
    ),
  }),
  warningMessage: z.string().optional(),
});
const forecastSchema = z.object({
  updateTime: z.string().datetime({ offset: true }),
  generalSituation: z.string(),
  weatherForecast: z.array(
    z.object({
      forecastDate: z.string().regex(/^\d{8}$/),
      forecastWeather: z.string(),
      forecastMaxtemp: z.object({ value: z.number().finite(), unit: z.string() }),
    }),
  ),
});
const warningsSchema = z.record(z.string(), z.unknown());

export type WeatherSnapshot = {
  source: 'Hong Kong Observatory Open Data';
  sourceUrl: string;
  dataStatus: 'live' | 'stale';
  fetchedAt: string;
  observedAt: string;
  forecastUpdatedAt: string;
  temperatureC: number;
  rainfallLastHourMm: number;
  forecastMaxTemperatureC: number;
  forecastSummary: string;
  generalSituation: string;
  warningMessage: string;
  warnings: Record<string, unknown>;
  signals: { rainObserved: boolean; hotForecast: boolean };
  location:
    | { scope: 'territory' }
    | {
        scope: 'nearby' | 'partial';
        temperatureStation?: string;
        rainfallArea?: string;
        distanceKm: number;
      };
};

export type WeatherLocation = { latitude: number; longitude: number };

type ObservationSite = { name: string; latitude: number; longitude: number };
type NearbySites = {
  temperature: ObservationSite;
  rainfall: ObservationSite;
  distanceKm: number;
};

// HKO observation payloads identify places by name; these approximate anchors enable nearest-place lookup.
const temperatureSites: ObservationSite[] = [
  { name: "King's Park", latitude: 22.311, longitude: 114.172 },
  { name: 'Hong Kong Observatory', latitude: 22.302, longitude: 114.174 },
  { name: 'Wong Chuk Hang', latitude: 22.248, longitude: 114.168 },
  { name: 'Ta Kwu Ling', latitude: 22.532, longitude: 114.157 },
  { name: 'Lau Fau Shan', latitude: 22.469, longitude: 113.983 },
  { name: 'Tai Po', latitude: 22.45, longitude: 114.164 },
  { name: 'Sha Tin', latitude: 22.402, longitude: 114.21 },
  { name: 'Tuen Mun', latitude: 22.391, longitude: 113.976 },
  { name: 'Tseung Kwan O', latitude: 22.315, longitude: 114.263 },
  { name: 'Sai Kung', latitude: 22.381, longitude: 114.273 },
  { name: 'Cheung Chau', latitude: 22.209, longitude: 114.03 },
  { name: 'Chek Lap Kok', latitude: 22.308, longitude: 113.916 },
  { name: 'Tsing Yi', latitude: 22.352, longitude: 114.1 },
  { name: 'Shek Kong', latitude: 22.43, longitude: 114.082 },
  { name: 'Tsuen Wan Ho Koon', latitude: 22.382, longitude: 114.112 },
  { name: 'Tsuen Wan Shing Mun Valley', latitude: 22.37, longitude: 114.11 },
  { name: 'Hong Kong Park', latitude: 22.278, longitude: 114.161 },
  { name: 'Shau Kei Wan', latitude: 22.278, longitude: 114.231 },
  { name: 'Kowloon City', latitude: 22.33, longitude: 114.19 },
  { name: 'Happy Valley', latitude: 22.27, longitude: 114.183 },
  { name: 'Wong Tai Sin', latitude: 22.342, longitude: 114.194 },
  { name: 'Stanley', latitude: 22.218, longitude: 114.214 },
  { name: 'Kwun Tong', latitude: 22.31, longitude: 114.226 },
  { name: 'Sham Shui Po', latitude: 22.33, longitude: 114.16 },
  { name: 'Kai Tak Runway Park', latitude: 22.304, longitude: 114.22 },
  { name: 'Yuen Long Park', latitude: 22.444, longitude: 114.027 },
  { name: 'Tai Mei Tuk', latitude: 22.468, longitude: 114.23 },
];

const rainfallSites: ObservationSite[] = [
  { name: 'Central & Western District', latitude: 22.286, longitude: 114.15 },
  { name: 'Eastern District', latitude: 22.284, longitude: 114.224 },
  { name: 'Kwai Tsing', latitude: 22.354, longitude: 114.1 },
  { name: 'Islands District', latitude: 22.261, longitude: 113.946 },
  { name: 'North District', latitude: 22.494, longitude: 114.139 },
  { name: 'Sai Kung', latitude: 22.382, longitude: 114.27 },
  { name: 'Sha Tin', latitude: 22.387, longitude: 114.195 },
  { name: 'Southern District', latitude: 22.247, longitude: 114.158 },
  { name: 'Tai Po', latitude: 22.451, longitude: 114.164 },
  { name: 'Tsuen Wan', latitude: 22.371, longitude: 114.114 },
  { name: 'Tuen Mun', latitude: 22.391, longitude: 113.976 },
  { name: 'Wan Chai', latitude: 22.277, longitude: 114.173 },
  { name: 'Yuen Long', latitude: 22.445, longitude: 114.02 },
  { name: 'Yau Tsim Mong', latitude: 22.308, longitude: 114.17 },
  { name: 'Sham Shui Po', latitude: 22.33, longitude: 114.16 },
  { name: 'Kowloon City', latitude: 22.328, longitude: 114.19 },
  { name: 'Wong Tai Sin', latitude: 22.342, longitude: 114.194 },
  { name: 'Kwun Tong', latitude: 22.31, longitude: 114.226 },
];

export class WeatherProviderError extends Error {
  readonly status = 502;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WeatherProviderError';
  }
}

export class HkoWeatherProvider {
  private cached = new Map<string, { expiresAt: number; snapshot: WeatherSnapshot }>();
  private inFlight = new Map<string, Promise<WeatherSnapshot>>();
  private readonly baseUrl = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php';

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly cacheMs = 5 * 60 * 1000,
    private readonly timeoutMs = 8_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getSnapshot(location?: WeatherLocation) {
    const nearby = location ? nearestSites(location) : undefined;
    const cacheKey = nearby ? `${nearby.temperature.name}:${nearby.rainfall.name}` : 'territory';
    const cached = this.cached.get(cacheKey);
    if (cached && cached.expiresAt > this.now().getTime()) return cached.snapshot;
    const inFlight = this.inFlight.get(cacheKey);
    if (inFlight) return inFlight;
    const request = this.fetchSnapshot(nearby);
    this.inFlight.set(cacheKey, request);
    try {
      const snapshot = await request;
      this.cached.set(cacheKey, { snapshot, expiresAt: this.now().getTime() + this.cacheMs });
      return snapshot;
    } catch (error) {
      if (cached) return { ...cached.snapshot, dataStatus: 'stale' };
      throw error;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async fetchJson(url: string) {
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new WeatherProviderError(`HKO returned HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  }

  private async fetchSnapshot(nearby?: NearbySites): Promise<WeatherSnapshot> {
    const params = (dataType: string) => {
      const url = new URL(this.baseUrl);
      url.searchParams.set('dataType', dataType);
      url.searchParams.set('lang', 'en');
      return url.toString();
    };
    try {
      const [currentRaw, forecastRaw, warningsRaw] = await Promise.all([
        this.fetchJson(params('rhrread')),
        this.fetchJson(params('fnd')),
        this.fetchJson(params('warnsum')),
      ]);
      const current = temperatureSchema.parse(currentRaw);
      const forecast = forecastSchema.parse(forecastRaw);
      const warnings = warningsSchema.parse(warningsRaw);
      const dailyForecast =
        forecast.weatherForecast.find((item) => item.forecastDate === hongKongDate(this.now())) ||
        forecast.weatherForecast[0];
      if (!dailyForecast || !current.temperature.data.length || !current.rainfall.data.length)
        throw new WeatherProviderError('HKO response is missing current weather observations');
      const temperatureAtSite = nearby
        ? current.temperature.data.find((item) => item.place === nearby.temperature.name)
        : undefined;
      const rainfallAtArea = nearby
        ? current.rainfall.data.find((item) => item.place === nearby.rainfall.name)
        : undefined;
      const temperatureC =
        temperatureAtSite?.value ?? Math.max(...current.temperature.data.map((item) => item.value));
      const rainfallLastHourMm =
        rainfallAtArea?.max ?? Math.max(...current.rainfall.data.map((item) => item.max));
      const hotForecast = /\bhot\b/i.test(dailyForecast.forecastWeather);
      return {
        source: 'Hong Kong Observatory Open Data',
        sourceUrl: 'https://www.hko.gov.hk/en/abouthko/opendata_intro.htm',
        dataStatus: 'live',
        fetchedAt: this.now().toISOString(),
        observedAt: current.temperature.recordTime || current.updateTime,
        forecastUpdatedAt: forecast.updateTime,
        temperatureC,
        rainfallLastHourMm,
        forecastMaxTemperatureC: dailyForecast.forecastMaxtemp.value,
        forecastSummary: dailyForecast.forecastWeather,
        generalSituation: forecast.generalSituation,
        warningMessage: current.warningMessage || '',
        warnings,
        signals: {
          rainObserved: rainfallLastHourMm > 0,
          hotForecast,
        },
        location: nearby
          ? {
              scope: temperatureAtSite && rainfallAtArea ? 'nearby' : 'partial',
              ...(temperatureAtSite ? { temperatureStation: nearby.temperature.name } : {}),
              ...(rainfallAtArea ? { rainfallArea: nearby.rainfall.name } : {}),
              distanceKm: Math.round(nearby.distanceKm * 10) / 10,
            }
          : { scope: 'territory' },
      };
    } catch (error) {
      if (error instanceof WeatherProviderError) throw error;
      throw new WeatherProviderError('Unable to retrieve valid weather data from HKO', {
        cause: error,
      });
    }
  }
}

function nearestSites(location: WeatherLocation): NearbySites {
  const temperature = nearestSite(location, temperatureSites);
  const rainfall = nearestSite(location, rainfallSites);
  return {
    temperature: temperature.site,
    rainfall: rainfall.site,
    distanceKm: temperature.distanceKm,
  };
}

function nearestSite(location: WeatherLocation, sites: ObservationSite[]) {
  return sites.reduce(
    (nearest, site) => {
      const distanceKm = distanceBetween(location, site);
      return distanceKm < nearest.distanceKm ? { site, distanceKm } : nearest;
    },
    { site: sites[0], distanceKm: Number.POSITIVE_INFINITY },
  );
}

function distanceBetween(first: WeatherLocation, second: WeatherLocation) {
  const radians = Math.PI / 180;
  const latitudeDelta = (second.latitude - first.latitude) * radians;
  const longitudeDelta = (second.longitude - first.longitude) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(first.latitude * radians) *
      Math.cos(second.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hongKongDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replaceAll('-', '');
}
