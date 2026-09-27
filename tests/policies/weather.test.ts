import { it, expect } from 'vitest';
import { fixture, ctx } from '../fixtures';
import { route } from '../../shared/routing/route';
import { weatherPolicy } from '../../shared/routing/policies';
it('rain increases exposed edge cost without negative bonuses', () => {
  const e = fixture().edges[0];
  e.indoor = false;
  expect(weatherPolicy.evaluate(e, { ...ctx, rain: true }).penalty).toBeGreaterThan(0);
  e.sheltered = true;
  expect(weatherPolicy.evaluate(e, { ...ctx, rain: true }).penalty).toBe(0);
});
it('rain plugin changes choice using same engine', () => {
  const g = fixture();
  g.edges
    .filter((e) => ['s-a', 'a-t'].includes(e.id))
    .forEach((e) => {
      e.indoor = false;
      e.distanceM = 4;
    });
  g.edges.filter((e) => ['s-b', 'b-t'].includes(e.id)).forEach((e) => (e.indoor = true));
  expect(route(g, 'start', 'end', ctx)).toMatchObject({ edgeIds: ['s-a', 'a', 'a-t'] });
  expect(route(g, 'start', 'end', { ...ctx, rain: true })).toMatchObject({
    edgeIds: ['s-b', 'b', 'b-t'],
  });
});
