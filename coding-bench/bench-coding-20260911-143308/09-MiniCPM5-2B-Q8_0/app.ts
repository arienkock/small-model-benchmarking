export interface Row {
    name: string;
    score: number;
}

export function renderRows(rows: Row[]): string {
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    return sorted.map((row) => `<tr><td>${row.name}</td><td>${row.score}</td></tr>`).join("\n");
}
