export interface SerialCandidate {
  serial: string;
  model?: string;
  status?: string;
}

export interface SerialSuggestions {
  matches: SerialCandidate[];
  typo: SerialCandidate | null;
}

export function normalizeSerialNumber(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function isValidChargerSerial(value: unknown): boolean {
  return /^TACW[A-Z0-9]{10,12}$/.test(normalizeSerialNumber(value));
}

function editDistanceAtMostOne(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 1) return 2;

  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  );
  for (let row = 0; row <= left.length; row++) matrix[row][0] = row;
  for (let column = 0; column <= right.length; column++) matrix[0][column] = column;

  for (let row = 1; row <= left.length; row++) {
    for (let column = 1; column <= right.length; column++) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let distance = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
      if (
        row > 1 && column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distance = Math.min(distance, matrix[row - 2][column - 2] + 1);
      }
      matrix[row][column] = distance;
    }
  }

  return matrix[left.length][right.length] <= 1 ? matrix[left.length][right.length] : 2;
}

export function findSerialSuggestions(
  query: unknown,
  candidates: readonly SerialCandidate[],
  limit = 8
): SerialSuggestions {
  const normalizedQuery = normalizeSerialNumber(query);
  if (normalizedQuery.length < 3) return { matches: [], typo: null };

  const uniqueCandidates = new Map<string, SerialCandidate>();
  for (const candidate of candidates) {
    const serial = normalizeSerialNumber(candidate.serial);
    if (isValidChargerSerial(serial) && !uniqueCandidates.has(serial)) {
      uniqueCandidates.set(serial, { ...candidate, serial });
    }
  }

  const ranked = Array.from(uniqueCandidates.values()).flatMap((candidate, order) => {
    const serial = candidate.serial;
    let rank: number | null = null;
    if (serial === normalizedQuery) rank = 0;
    else if (serial.startsWith(normalizedQuery)) rank = 1;
    else if (serial.startsWith('TACW') && serial.slice(4) === normalizedQuery) rank = 1;
    else if (serial.includes(normalizedQuery)) rank = 2;
    return rank === null ? [] : [{ candidate, rank, order }];
  }).sort((left, right) => left.rank - right.rank || left.order - right.order);

  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit) || 8));
  if (ranked.length) {
    return { matches: ranked.slice(0, safeLimit).map(({ candidate }) => candidate), typo: null };
  }

  if (normalizedQuery.length < 13 || normalizedQuery.length > 17) {
    return { matches: [], typo: null };
  }

  let bestDistance = 2;
  let bestCandidates: SerialCandidate[] = [];
  for (const candidate of uniqueCandidates.values()) {
    const distance = editDistanceAtMostOne(normalizedQuery, candidate.serial);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCandidates = [candidate];
    } else if (distance === bestDistance && distance <= 1) {
      bestCandidates.push(candidate);
    }
  }

  return { matches: [], typo: bestDistance === 1 && bestCandidates.length === 1 ? bestCandidates[0] : null };
}