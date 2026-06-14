import type React from "react";
import { useState, useEffect } from "react";

interface AppProps {
	title: string;
	initialCount?: number;
}

function useCounter(initial: number = 0) {
	const [count, setCount] = useState(initial);
	const increment = () => setCount((c) => c + 1);
	const decrement = () => setCount((c) => c - 1);
	return { count, increment, decrement };
}

export const App: React.FC<AppProps> = ({ title, initialCount = 0 }) => {
	const { count, increment, decrement } = useCounter(initialCount);

	useEffect(() => {
		document.title = `${title} - ${count}`;
	}, [count, title]);

	return (
		<div className="app">
			<h1>{title}</h1>
			<p>Count: {count}</p>
			<button onClick={increment}>+</button>
			<button onClick={decrement}>-</button>
		</div>
	);
};

export default App;
