import type { KnowledgeRecord } from './types';

const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const grams = (s: string) =>
  new Set(Array.from({ length: Math.max(1, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
export function searchKnowledge(records: KnowledgeRecord[], query: string, level?: string) {
  const q = normalize(query),
    parts = grams(q);
  return records
    .filter((r) => !level || r.level_id === level)
    .map((record) => {
      const score = Math.max(
        ...record.names.map((name) => {
          const text = normalize(name);
          if (!q) return 0;
          if (text.includes(q) || q.includes(text)) return 1;
          const other = grams(text),
            overlap = [...parts].filter((p) => other.has(p)).length;
          return (2 * overlap) / (parts.size + other.size);
        }),
      );
      return { record, score };
    })
    .filter((r) => !q || r.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}
