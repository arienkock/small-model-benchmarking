// Row interface representing a table row
interface Row {
    name: string;
    score: number;
}

// Renders an array of Row objects as an HTML table fragment.
// Rows are sorted by score in descending order.
function renderRows(rows: Row[]): string {
    // Sort rows by score descending
    const sorted = rows.sort((a, b) => b.score - a.score);

    // Build the HTML fragment
    const fragment = sorted.map(row => `
        <tr>
            <td>${row.name}</td>
            <td>${row.score}</td>
        </tr>`).join("");

    return fragment;
}

// Example usage
const exampleRows: Row[] = [
    { name: "Alice", score: 95 },
    { name: "Bob", score: 87 },
    { name: "Charlie", score: 92 },
    { name: "Diana", score: 78 },
];

console.log(renderRows(exampleRows));
