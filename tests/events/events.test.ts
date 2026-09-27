import { it, expect } from 'vitest';
import { fixture, ctx, close } from '../fixtures';
import { route } from '../../shared/routing/route';
import { eventSchema } from '../../shared/domain/schema';
it('closed lift A uses B and all closures return no_route without mutation', () => {
  const g = fixture(),
    copy = JSON.stringify(g);
  const r = route(g, 'start', 'end', { ...ctx, events: [close('lift-a')] });
  expect(r).toMatchObject({ status: 'ok', edgeIds: ['s-b', 'b', 'b-t'] });
  expect(
    route(g, 'start', 'end', { ...ctx, events: [close('lift-a'), close('lift-b')] }).status,
  ).toBe('no_route');
  expect(JSON.stringify(g)).toBe(copy);
});
it.each(['resolved', 'expired', 'future'])('%s events do not block', (kind) => {
  const e = close('lift-a');
  const event = {
    ...e,
    ...(kind === 'resolved'
      ? { status: 'resolved' as const }
      : kind === 'expired'
        ? { validUntil: '2026-09-26T23:59:59Z' }
        : { validFrom: '2027-01-01T00:00:00Z' }),
  };
  expect(route(fixture(), 'start', 'end', { ...ctx, events: [event] })).toMatchObject({
    status: 'ok',
    edgeIds: ['s-a', 'a', 'a-t'],
  });
});
it('event validity range is checked', () =>
  expect(() =>
    eventSchema.parse({ ...close('lift-a'), validUntil: '2025-01-01T00:00:00Z' }),
  ).toThrow());
it('edge-targeted construction blocks only selected connection', () => {
  const e = { ...close('lift-a'), type: 'construction' as const, target: { edgeIds: ['a'] } };
  expect(route(fixture(), 'start', 'end', { ...ctx, events: [e] })).toMatchObject({
    status: 'ok',
    edgeIds: ['s-b', 'b', 'b-t'],
  });
});
