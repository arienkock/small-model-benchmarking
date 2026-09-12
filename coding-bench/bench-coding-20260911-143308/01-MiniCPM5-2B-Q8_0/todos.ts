export interface Todo {
    id: number;
    title: string;
    done: boolean;
}

export async function fetchTodos(baseUrl: string): Promise<Todo[]> {
    const response = await fetch(`${baseUrl}/api/todos`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json() as Promise<Todo[]>;
}
