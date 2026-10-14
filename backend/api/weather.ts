import { Router } from 'express';
import { z } from 'zod';
import { HkoWeatherProvider } from '../providers/weather';

const hongKongBounds = {
  minLatitude: 22.1,
  maxLatitude: 22.6,
  minLongitude: 113.75,
  maxLongitude: 114.5,
};

function vercelIpLocation(req: import('express').Request) {
  if (req.get('x-vercel-ip-country')?.toUpperCase() !== 'HK') return undefined;
  const latitude = Number(req.get('x-vercel-ip-latitude'));
  const longitude = Number(req.get('x-vercel-ip-longitude'));
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < hongKongBounds.minLatitude ||
    latitude > hongKongBounds.maxLatitude ||
    longitude < hongKongBounds.minLongitude ||
    longitude > hongKongBounds.maxLongitude
  )
    return undefined;
  return { latitude, longitude };
}

export function weatherRouter(
  provider: HkoWeatherProvider,
  { useVercelLocationHeaders = false }: { useVercelLocationHeaders?: boolean } = {},
) {
  const router = Router();
  router.get('/weather', async (req, res, next) => {
    try {
      const query = z
        .object({
          latitude: z.coerce
            .number()
            .finite()
            .min(hongKongBounds.minLatitude)
            .max(hongKongBounds.maxLatitude)
            .optional(),
          longitude: z.coerce
            .number()
            .finite()
            .min(hongKongBounds.minLongitude)
            .max(hongKongBounds.maxLongitude)
            .optional(),
        })
        .safeParse(req.query);
      if (!query.success) {
        res.status(400).json({ error: 'GPS coordinates must be within the Hong Kong region' });
        return;
      }
      const { latitude, longitude } = query.data;
      if ((latitude === undefined) !== (longitude === undefined)) {
        res.status(400).json({ error: 'Both latitude and longitude are required' });
        return;
      }
      const gpsLocation =
        latitude === undefined || longitude === undefined ? undefined : { latitude, longitude };
      const ipLocation =
        gpsLocation || !useVercelLocationHeaders ? undefined : vercelIpLocation(req);
      const location = gpsLocation || ipLocation;
      const snapshot = await provider.getSnapshot(location);
      res.json({
        ...snapshot,
        locationSource: gpsLocation ? 'gps' : ipLocation ? 'ip' : 'territory',
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
