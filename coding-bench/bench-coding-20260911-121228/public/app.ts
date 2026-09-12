// Row interface and table rendering function

export interface Row {
    name: string;
    score: number;
}

/**
 * Renders an array of Row objects as an HTML table fragment.
 * Rows are sorted by score descending.
 * 
 * @param rows - Array of Row objects
 * @returns HTML string containing <tr><td>name</td><td>score</td></tr> rows
 */
export function renderRows(rows: Row[]): string {
    // Sort by score descending
    const sorted = [...rows].sort((a, b) => b.score - a.score);

    // Build HTML fragment
    const fragment = sorted.map(row => `
        <tr>
            <td>${row.name}</td>
            <td>${row.score}</td>
        </tr>
    `).join("");

    return fragment;
}

// Self-test: print an example renderRows output
const exampleRows: Row[] = [
    { name: "Alice", score: 95 },
    { name: "Bob", score: 87 },
    { name: "Charlie", score: 92 },
    { name: "Diana", score: 78 },
    { name: "Eve", score: 88 }
];

console.log("Example renderRows output:");
console.log(renderRows(exampleRows));
console.log("");
console.log("Test passed!");
