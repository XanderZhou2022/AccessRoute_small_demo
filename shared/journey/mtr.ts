export type MtrStation = {
  code: string;
  name: string;
  nameZh: string;
};

export type MtrHop = {
  from: MtrStation;
  to: MtrStation;
  lineCode: string;
};

export type MtrRoute = {
  stations: MtrStation[];
  hops: MtrHop[];
};

type MtrRow = MtrStation & {
  lineCode: string;
  direction: string;
  stationId: string;
  sequence: number;
};

function parseCsvRow(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function parseRows(csv: string): MtrRow[] {
  const [headerLine, ...lines] = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
  if (!headerLine) throw new Error('MTR station data is empty');
  const headers = parseCsvRow(headerLine);
  const column = (name: string) => {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(`MTR station data is missing ${name}`);
    return index;
  };
  const lineIndex = column('Line Code');
  const directionIndex = column('Direction');
  const codeIndex = column('Station Code');
  const idIndex = column('Station ID');
  const zhIndex = column('Chinese Name');
  const nameIndex = column('English Name');
  const sequenceIndex = column('Sequence');
  return lines
    .filter((line) => line.trim() && parseCsvRow(line).some((value) => value.trim()))
    .map((line) => {
      const row = parseCsvRow(line);
      const sequence = Number(row[sequenceIndex]);
      if (
        !row[lineIndex] ||
        !row[directionIndex] ||
        !row[codeIndex] ||
        !row[nameIndex] ||
        !Number.isFinite(sequence)
      )
        throw new Error('MTR station data contains an invalid row');
      return {
        lineCode: row[lineIndex],
        direction: row[directionIndex],
        code: row[codeIndex],
        stationId: row[idIndex],
        nameZh: row[zhIndex],
        name: row[nameIndex],
        sequence,
      };
    });
}

export function findMtrRoute(csv: string, fromName: string, toName: string): MtrRoute | null {
  const rows = parseRows(csv);
  const normalizedName = (name: string) =>
    name
      .trim()
      .replace(/\s+station$/i, '')
      .toLocaleLowerCase();
  const stationByCode = new Map<string, MtrStation>();
  const stationCodesById = new Map<string, Set<string>>();
  for (const row of rows) {
    stationByCode.set(row.code, { code: row.code, name: row.name, nameZh: row.nameZh });
    if (!stationCodesById.has(row.stationId)) stationCodesById.set(row.stationId, new Set());
    stationCodesById.get(row.stationId)!.add(row.code);
  }

  const findCode = (name: string) =>
    rows.find((row) => normalizedName(row.name) === normalizedName(name))?.code;
  const from = findCode(fromName);
  const to = findCode(toName);
  if (!from || !to) return null;
  if (from === to) return { stations: [stationByCode.get(from)!], hops: [] };

  const adjacency = new Map<string, MtrHop[]>();
  const addHop = (hop: MtrHop) => {
    if (!adjacency.has(hop.from.code)) adjacency.set(hop.from.code, []);
    const neighbors = adjacency.get(hop.from.code)!;
    if (
      !neighbors.some(
        (existing) => existing.to.code === hop.to.code && existing.lineCode === hop.lineCode,
      )
    )
      neighbors.push(hop);
  };
  const directionGroups = new Map<string, MtrRow[]>();
  for (const row of rows) {
    const key = `${row.lineCode}:${row.direction}`;
    if (!directionGroups.has(key)) directionGroups.set(key, []);
    directionGroups.get(key)!.push(row);
  }
  for (const group of directionGroups.values()) {
    group.sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < group.length; i += 1) {
      const fromStation = stationByCode.get(group[i - 1].code)!;
      const toStation = stationByCode.get(group[i].code)!;
      addHop({ from: fromStation, to: toStation, lineCode: group[i].lineCode });
    }
  }
  for (const codes of stationCodesById.values()) {
    const linkedCodes = [...codes];
    for (const fromCode of linkedCodes) {
      for (const toCode of linkedCodes) {
        if (fromCode !== toCode)
          addHop({
            from: stationByCode.get(fromCode)!,
            to: stationByCode.get(toCode)!,
            lineCode: 'TRANSFER',
          });
      }
    }
  }

  const queue = [from];
  const previous = new Map<string, MtrHop | null>([[from, null]]);
  for (let i = 0; i < queue.length && !previous.has(to); i += 1) {
    const current = queue[i];
    for (const hop of adjacency.get(current) || []) {
      if (previous.has(hop.to.code)) continue;
      previous.set(hop.to.code, hop);
      queue.push(hop.to.code);
    }
  }
  if (!previous.has(to)) return null;

  const hops: MtrHop[] = [];
  let current = to;
  while (current !== from) {
    const hop = previous.get(current);
    if (!hop) throw new Error('MTR route predecessor is missing');
    hops.unshift(hop);
    current = hop.from.code;
  }
  const withTransfers: MtrHop[] = [];
  for (const hop of hops) {
    const previousHop = withTransfers.at(-1);
    if (previousHop && previousHop.lineCode !== 'TRANSFER' && previousHop.lineCode !== hop.lineCode)
      withTransfers.push({
        from: hop.from,
        to: hop.from,
        lineCode: 'TRANSFER',
      });
    withTransfers.push(hop);
  }
  return {
    stations: [stationByCode.get(from)!, ...withTransfers.map((hop) => hop.to)],
    hops: withTransfers,
  };
}

export function mtrLineName(lineCode: string): string {
  const names: Record<string, string> = {
    AEL: '機場快綫',
    DRL: '迪士尼綫',
    EAL: '東鐵綫',
    ISL: '港島綫',
    KTL: '觀塘綫',
    SIL: '南港島綫',
    TCL: '東涌綫',
    TML: '屯馬綫',
    TKL: '將軍澳綫',
    TWL: '荃灣綫',
  };
  if (lineCode === 'TRANSFER') return '轉乘';
  return names[lineCode] || lineCode;
}
