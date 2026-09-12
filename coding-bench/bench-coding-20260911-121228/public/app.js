// Minimal app.js that loads and uses the renderRows function
const rows = [
    { name: "Alice", score: 95 },
    { name: "Bob", score: 87 },
    { name: "Charlie", score: 92 },
    { name: "Diana", score: 78 },
    { name: "Eve", score: 88 }
];

// Render rows sorted by score descending
const rendered = renderRows(rows);

// Insert the table into the DOM
const container = document.getElementById("table-container");
const table = document.createElement("table");
table.border = "1";
table.cellPadding = "8";

table.innerHTML = rendered;
container.appendChild(table);
