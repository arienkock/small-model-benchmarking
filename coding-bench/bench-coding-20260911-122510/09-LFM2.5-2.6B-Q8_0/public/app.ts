export interface Row {
    name: string;
    score: number;
}

export function renderRows(rows: Row[]): string {
    // Sort rows by score descending
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    // Build HTML fragment of table rows
    let html = '<tr>';
    for (const row of sorted) {
        html += `<td>${row.name}</td><td>${row.score}</td>`;
    }
    html += '</tr>';
    return html;
}
