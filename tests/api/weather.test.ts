import { expect, it } from 'vitest';
import { HkoWeatherProvider, WeatherProviderError } from '../../backend/providers/weather';
import { createApp } from '../../backend/app';
import request from 'supertest';

const current = {
  updateTime: '2026-10-13T09:02:00+08:00',
  temperature: {
    recordTime: '2026-10-13T09:00:00+08:00',
    data: [
      { place: 'Hong Kong Observatory', value: 28, unit: 'C' },
      { place: 'Happy Valley', value: 30, unit: 'C' },
    ],
  },
  rainfall: {
    startTime: '2026-10-13T07:45:00+08:00',
    endTime: '2026-10-13T08:45:00+08:00',
    data: [
      { place: 'Wan Chai', max: 0.5, unit: 'mm' },
      { place: 'Tai Po', max: 3, unit: 'mm' },
    ],
  },
  warningMessage: '',
};
const forecast = {
  updateTime: '2026-10-13T07:50:00+08:00',
  generalSituation: 'Fine and hot during the day.',
  weatherForecast: [
    {
      forecastDate: '20261013',
      forecastWeather: 'Sunny. Dry and hot during the day.',
      forecastMaxtemp: { value: 32, unit: 'C' },
    },
  ],
};

it('normalizes official HKO data and caches successful responses for five minutes', async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    const body = url.includes('rhrread') ? current : url.includes('fnd') ? forecast : {};
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const provider = new HkoWeatherProvider(
    fetcher,
    5 * 60_000,
    8_000,
    () => new Date('2026-10-13T01:00:00.000Z'),
  );
  const first = await provider.getSnapshot();
  const second = await provider.getSnapshot();
  expect(first).toEqual(second);
  expect(first.dataStatus).toBe('live');
  expect(first.temperatureC).toBe(30);
  expect(first.rainfallLastHourMm).toBe(3);
  expect(first.forecastMaxTemperatureC).toBe(32);
  expect(first.signals).toEqual({ rainObserved: true, hotForecast: true });
  expect(requests).toHaveLength(3);
  expect(requests.every((url) => new URL(url).searchParams.get('lang') === 'en')).toBe(true);

  const nearby = await provider.getSnapshot({ latitude: 22.27, longitude: 114.183 });
  expect(nearby.temperatureC).toBe(30);
  expect(nearby.rainfallLastHourMm).toBe(0.5);
  expect(nearby.location).toMatchObject({
    scope: 'nearby',
    temperatureStation: 'Happy Valley',
    rainfallArea: 'Wan Chai',
  });
  expect(requests).toHaveLength(6);
  await provider.getSnapshot({ latitude: 22.2701, longitude: 114.1831 });
  expect(requests).toHaveLength(6);
});

it('normalizes HKO warningMessage arrays as displayable text', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    const body = url.includes('rhrread')
      ? { ...current, warningMessage: ['Fire Danger Warning is in force.', 'Take care.'] }
      : url.includes('fnd')
        ? forecast
        : {};
    return new Response(JSON.stringify(body), { status: 200 });
  };

  const snapshot = await new HkoWeatherProvider(fetcher).getSnapshot();

  expect(snapshot.warningMessage).toBe('Fire Danger Warning is in force. Take care.');
});

it('returns an explicitly stale snapshot when a refresh fails after cache expiry', async () => {
  let now = new Date('2026-10-13T01:00:00.000Z');
  let available = true;
  const fetcher: typeof fetch = async (input) => {
    if (!available) throw new Error('offline');
    const url = String(input);
    const body = url.includes('rhrread') ? current : url.includes('fnd') ? forecast : {};
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const provider = new HkoWeatherProvider(fetcher, 5 * 60_000, 8_000, () => now);
  expect((await provider.getSnapshot()).dataStatus).toBe('live');
  now = new Date(now.getTime() + 5 * 60_000 + 1);
  available = false;
  const stale = await provider.getSnapshot();
  expect(stale.dataStatus).toBe('stale');
  expect(stale.fetchedAt).toBe('2026-10-13T01:00:00.000Z');
});

it('does not turn provider failures or malformed payloads into successful weather data', async () => {
  const unavailable: typeof fetch = async () => new Response('unavailable', { status: 503 });
  await expect(new HkoWeatherProvider(unavailable).getSnapshot()).rejects.toBeInstanceOf(
    WeatherProviderError,
  );
  const malformed: typeof fetch = async () => new Response('{}', { status: 200 });
  await expect(new HkoWeatherProvider(malformed).getSnapshot()).rejects.toBeInstanceOf(
    WeatherProviderError,
  );
});

it('rejects incomplete or out-of-region GPS coordinates before requesting HKO', async () => {
  const app = createApp();
  await request(app).get('/api/weather?latitude=22.3').expect(400);
  await request(app).get('/api/weather?latitude=51.5&longitude=-0.12').expect(400);
});

it('uses trusted platform IP coordinates only when enabled and within Hong Kong', async () => {
  const makeProvider = () =>
    new HkoWeatherProvider(
      async (input) => {
        const url = String(input);
        const body = url.includes('rhrread') ? current : url.includes('fnd') ? forecast : {};
        return new Response(JSON.stringify(body), { status: 200 });
      },
      5 * 60_000,
      8_000,
      () => new Date('2026-10-13T01:00:00.000Z'),
    );
  const headers = (
    app = createApp({ weatherProvider: makeProvider(), useVercelWeatherLocationHeaders: true }),
  ) =>
    request(app)
      .get('/api/weather')
      .set('x-vercel-ip-country', 'HK')
      .set('x-vercel-ip-latitude', '22.27')
      .set('x-vercel-ip-longitude', '114.183');

  const ipLocated = await headers().expect(200);
  expect(ipLocated.body.locationSource).toBe('ip');
  expect(ipLocated.body.location.scope).toBe('nearby');

  const spoofedLocally = await headers(
    createApp({ weatherProvider: makeProvider(), useVercelWeatherLocationHeaders: false }),
  ).expect(200);
  expect(spoofedLocally.body.locationSource).toBe('territory');
  expect(spoofedLocally.body.location.scope).toBe('territory');

  const outsideHongKong = await request(
    createApp({ weatherProvider: makeProvider(), useVercelWeatherLocationHeaders: true }),
  )
    .get('/api/weather')
    .set('x-vercel-ip-country', 'HK')
    .set('x-vercel-ip-latitude', '51.5')
    .set('x-vercel-ip-longitude', '-0.12')
    .expect(200);
  expect(outsideHongKong.body.locationSource).toBe('territory');
  expect(outsideHongKong.body.location.scope).toBe('territory');
});
